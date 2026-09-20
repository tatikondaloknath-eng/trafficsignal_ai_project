
import os, socket, json, heapq
from datetime import datetime, timezone
import pymysql

_original_getaddrinfo = socket.getaddrinfo

def ipv6_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        return _original_getaddrinfo(host, port, socket.AF_INET6, type, proto, flags)
    except Exception:
        return _original_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

socket.getaddrinfo = ipv6_only_getaddrinfo

DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", 26298))
DB_USER = os.environ.get("DB_USER", "avnadmin")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")
DB_NAME = os.environ.get("DB_NAME", "defaultdb")
DB_CA_FILE = os.environ.get("DB_CA_FILE", "ca.pem")

NETWORK_COORDS = {1:(0,0),2:(1,0),3:(0,1),4:(1,1)}
NETWORK_GRAPH = {1:{2:36.0,3:40.0},2:{1:36.0,4:38.0},3:{1:40.0,4:35.0},4:{2:38.0,3:35.0}}
APPROACH_FACTORS = {
 1:{"North":1.22,"South":0.94,"East":1.05,"West":0.79},
 2:{"North":1.03,"South":1.17,"East":0.98,"West":0.88},
 3:{"North":0.91,"South":0.83,"East":1.18,"West":1.08},
 4:{"North":1.00,"South":1.09,"East":0.96,"West":1.12},
}
EMERGENCY_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS emergency_requests (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    ambulance_id VARCHAR(64) NOT NULL,
    current_junction INT NOT NULL,
    destination INT NOT NULL,
    emergency_level VARCHAR(20) NOT NULL,
    route_json TEXT NOT NULL,
    route_cost_seconds DOUBLE NOT NULL DEFAULT 0,
    route_index INT NOT NULL DEFAULT 0,
    segment_seconds DOUBLE NOT NULL DEFAULT 0,
    segment_started_at DATETIME NOT NULL,
    status VARCHAR(32) NOT NULL,
    started_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    INDEX idx_emergency_status (status),
    INDEX idx_emergency_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""

def get_db_connection():
    ssl_config = {"ca": DB_CA_FILE} if os.path.exists(DB_CA_FILE) else None
    return pymysql.connect(host=DB_HOST,port=DB_PORT,user=DB_USER,password=DB_PASSWORD,database=DB_NAME,charset="utf8mb4",cursorclass=pymysql.cursors.DictCursor,connect_timeout=15,ssl=ssl_config)

def ensure_emergency_table(conn):
    with conn.cursor() as c: c.execute(EMERGENCY_TABLE_SQL)
    conn.commit()

def db_now(): return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

def fetch_network_frame(frame_index=0):
    conn=get_db_connection()
    try:
        with conn.cursor() as c:
            c.execute("SELECT COUNT(*) AS total FROM traffic_data")
            total=int(c.fetchone()["total"] or 0)
            if total < 4: raise RuntimeError("traffic_data must contain at least 4 rows.")
            chunk=max(1,total//4)
            frame_count=chunk
            frame_index=int(frame_index)%frame_count
            rows={}
            for j in range(1,5):
                off=(j-1)*chunk+frame_index
                c.execute("SELECT id,vehicle_count,average_speed,lane_occupancy,flow_rate,time_of_day,waiting_time FROM traffic_data ORDER BY id ASC LIMIT 1 OFFSET %s",(off,))
                r=c.fetchone()
                if not r:
                    c.execute("SELECT id,vehicle_count,average_speed,lane_occupancy,flow_rate,time_of_day,waiting_time FROM traffic_data ORDER BY id DESC LIMIT 1")
                    r=c.fetchone()
                rows[j]={"source_id":int(r["id"]),"vehicle_count":max(0,int(r["vehicle_count"] or 0)),"average_speed":max(0,float(r["average_speed"] or 0)),"lane_occupancy":max(0,min(100,float(r["lane_occupancy"] or 0))),"flow_rate":max(0,float(r["flow_rate"] or 0)),"time_of_day":str(r["time_of_day"] or ""),"waiting_time":max(0,float(r["waiting_time"] or 0))}
            return frame_index,frame_count,rows
    finally: conn.close()

def congestion(row):
    return round(max(0,min(100,0.30*min(100,row["vehicle_count"]/1.5)+0.28*row["lane_occupancy"]+0.25*min(100,row["waiting_time"]/1.2)+0.17*max(0,min(100,100-row["average_speed"]*2.2)))),1)

def _edge_direction(a,b):
    ax,ay=NETWORK_COORDS[a]; bx,by=NETWORK_COORDS[b]
    if bx>ax:return "East"
    if bx<ax:return "West"
    if by>ay:return "South"
    return "North"

def edge_cost(a,b,cong,rows): return float(NETWORK_GRAPH[a][b])+cong[b]*0.70+rows[b]["waiting_time"]*0.55+cong[a]*0.15

def astar_route(start,goal,cong,rows):
    start,goal=int(start),int(goal)
    if start==goal:return [start],0.0,[]
    def h(n):
        x1,y1=NETWORK_COORDS[n]; x2,y2=NETWORK_COORDS[goal]
        return (abs(x1-x2)+abs(y1-y2))*33.0
    pq=[(h(start),0.0,start)]; came={}; gs={start:0.0}; seen=set()
    while pq:
        _,g,node=heapq.heappop(pq)
        if node in seen: continue
        seen.add(node)
        if node==goal: break
        for nxt in NETWORK_GRAPH[node]:
            ng=g+edge_cost(node,nxt,cong,rows)
            if ng<gs.get(nxt,float('inf')):
                gs[nxt]=ng; came[nxt]=node; heapq.heappush(pq,(ng+h(nxt),ng,nxt))
    if goal not in gs: raise RuntimeError("No route exists.")
    path=[goal]
    while path[-1]!=start:path.append(came[path[-1]])
    path.reverse(); seg=[]
    for a,b in zip(path,path[1:]): seg.append({"from":a,"to":b,"direction":_edge_direction(a,b),"seconds":round(edge_cost(a,b,cong,rows),1),"congestion_at_destination":cong[b]})
    return path,round(gs[goal],1),seg

def latest_emergency():
    conn=get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as c:
            c.execute("SELECT * FROM emergency_requests WHERE status IN ('ACTIVE','AT DESTINATION') ORDER BY id DESC LIMIT 1")
            return c.fetchone()
    finally: conn.close()

def emergency_payload(rows):
    conn=get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as c:
            c.execute("SELECT * FROM emergency_requests WHERE status IN ('ACTIVE','AT DESTINATION') ORDER BY id DESC LIMIT 1")
            row=c.fetchone()
        if not row:return {"active":False,"status":"NORMAL","route":[],"route_index":0}
        route=[int(x) for x in json.loads(row["route_json"] or "[]")]; idx=int(row["route_index"] or 0)
        cong={j:congestion(rows[j]) for j in range(1,5)}
        seg=float(row["segment_seconds"] or 0); prog=1.0
        if row["status"]=="ACTIVE" and idx<len(route)-1 and seg>0:
            try:
                st=datetime.strptime(str(row["segment_started_at"]),"%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                prog=min(0.99,max(0,(datetime.now(timezone.utc).timestamp()-st.timestamp())/seg))
            except Exception: prog=0.0
        nextj=route[idx+1] if idx+1<len(route) else None
        eta=sum(edge_cost(a,b,cong,rows) for a,b in zip(route[idx:],route[idx+1:])) if idx<len(route)-1 else 0
        return {"active":True,"request_id":int(row["id"]),"ambulance_id":row["ambulance_id"],"current_junction":int(row["current_junction"]),"destination":int(row["destination"]),"emergency_level":row["emergency_level"],"route":route,"route_index":idx,"next_junction":nextj,"status":row["status"],"segment_seconds":round(seg,1),"segment_progress":round(prog,3),"estimated_time_seconds":round(eta,1),"congestion":cong}
    finally: conn.close()

def activate_emergency(ambulance_id,start,goal,level,frame=0):
    _,_,rows=fetch_network_frame(frame); cong={j:congestion(rows[j]) for j in range(1,5)}
    route,cost,segments=astar_route(start,goal,cong,rows); now=db_now(); first=segments[0]["seconds"] if segments else 0
    conn=get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as c:
            c.execute("UPDATE emergency_requests SET status='CLEARED',updated_at=%s WHERE status IN ('ACTIVE','AT DESTINATION')",(now,))
            c.execute("""INSERT INTO emergency_requests (ambulance_id,current_junction,destination,emergency_level,route_json,route_cost_seconds,route_index,segment_seconds,segment_started_at,status,started_at,updated_at) VALUES (%s,%s,%s,%s,%s,%s,0,%s,%s,'ACTIVE',%s,%s)""",(ambulance_id,start,goal,level,json.dumps(route),cost,first,now,now,now))
            request_id=c.lastrowid
        conn.commit()
    finally: conn.close()
    return {"request_id":int(request_id),"route":route,"estimated_time_seconds":cost,"segments":segments,"congestion":cong}

def advance_emergency(frame=0):
    current=latest_emergency()
    if not current:return {"ok":False,"message":"No active emergency request."}
    route=[int(x) for x in json.loads(current["route_json"] or "[]")]; idx=int(current["route_index"] or 0)
    if idx>=len(route)-1:return {"ok":True,"message":"Ambulance already at destination."}
    nextj=route[idx+1]
    _,_,rows=fetch_network_frame(frame); cong={j:congestion(rows[j]) for j in range(1,5)}
    nextseg=edge_cost(nextj,route[idx+2],cong,rows) if idx+2<len(route) else 0
    newidx=idx+1; status='AT DESTINATION' if newidx>=len(route)-1 else 'ACTIVE'; now=db_now()
    conn=get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as c:c.execute("UPDATE emergency_requests SET current_junction=%s,route_index=%s,segment_seconds=%s,segment_started_at=%s,status=%s,updated_at=%s WHERE id=%s",(nextj,newidx,nextseg,now,status,now,int(current["id"])))
        conn.commit()
    finally: conn.close()
    return {"ok":True,"message":f"Ambulance advanced to J{nextj}.","current_junction":nextj,"status":status}

def clear_emergency():
    now=db_now(); conn=get_db_connection()
    try:
        ensure_emergency_table(conn)
        with conn.cursor() as c:c.execute("UPDATE emergency_requests SET status='CLEARED',updated_at=%s WHERE status IN ('ACTIVE','AT DESTINATION')",(now,))
        conn.commit()
    finally: conn.close()
