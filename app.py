from flask import Flask

app = Flask(__name__)

@app.route("/")
def home():
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Smart Traffic Management</title>
        <style>
            body {
                margin: 0;
                font-family: Arial, sans-serif;
                background: #071a2f;
                color: white;
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                text-align: center;
            }

            .container {
                max-width: 800px;
                padding: 50px;
            }

            h1 {
                font-size: 42px;
                margin-bottom: 15px;
            }

            p {
                font-size: 20px;
                color: #b8c7d9;
            }

            .status {
                margin-top: 30px;
                padding: 20px;
                border-radius: 15px;
                background: #102b47;
                border: 1px solid #244d70;
            }

            .success {
                color: #45e08a;
                font-weight: bold;
            }
        </style>
    </head>

    <body>
        <div class="container">
            <h1>🚦 Smart Traffic Management</h1>

            <p>
                Adaptive Multi-Agent Traffic Signal Optimization
            </p>

            <p>
                using AI Search and Constraint-Based Optimization
            </p>

            <div class="status">
                <h2 class="success">✓ Flask Application Running</h2>
                <p>Render deployment successful.</p>
            </div>
        </div>
    </body>
    </html>
    """

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
