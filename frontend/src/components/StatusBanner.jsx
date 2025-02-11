import { useState, useEffect } from "react";

const StatusBanner = () => {
    const [showBanner, setShowBanner] = useState(false);
    const command = "docker-compose down --volumes && docker-compose up -d";

    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const response = await fetch("http://localhost:8000/api/mz-status");
                if (!response.ok) throw new Error("Failed to fetch status");
                const data = await response.json();
                setShowBanner(data.restart === true);
            } catch (error) {
                console.error("Error fetching Materialize status:", error);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 1000); // Runs every second

        return () => {}; // No cleanup, so it keeps polling
    }, []); // Empty dependency array ensures it starts once but keeps running

    if (!showBanner) return null;

    const copyToClipboard = () => {
        navigator.clipboard.writeText(command);
    };

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                width: "100%",
                backgroundColor: "red",
                color: "white",
                padding: "10px 16px",
                textAlign: "center",
                fontWeight: "bold",
                fontSize: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                zIndex: 1000,
            }}
        >
            Did your computer fall asleep? Restart the demo with
            <code
                style={{
                    backgroundColor: "black",
                    color: "white",
                    padding: "4px 6px",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                }}
            >
                {command}
            </code>
            <button
                onClick={copyToClipboard}
                style={{
                    backgroundColor: "white",
                    color: "black",
                    border: "none",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: "bold",
                }}
            >
                Copy
            </button>
        </div>
    );
};

export default StatusBanner;
