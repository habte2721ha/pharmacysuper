
# Advanced Pharmacy Stock Management System (APSMS)

A robust, AI-integrated pharmacy inventory and POS system designed for single or multi-user desktop environments.

## 🚀 Features
- **Desktop Application**: Runs as a native `.exe` on Windows.
- **Client-Server**: One PC acts as the Host (Server), others connect via Wi-Fi.
- **AI Integration**: Google Gemini for Reports & Translation.
- **Hardware Ready**: Supports Receipt Printers and Cash Drawers.

---

## 🛠️ How to Build the Desktop Installer (.exe)

If you have downloaded the source code and want to create the installable file:

1.  **Install Requirements** (First time only):
    ```bash
    npm install
    ```

2.  **Generate Installer**:
    Run this command to build the Windows `.exe`:
    ```bash
    npm run make-installer
    ```
    *(Note: This process takes 2-5 minutes. It builds the React frontend first, then packages the Electron app.)*

3.  **Find the File**:
    Go to the **`dist`** folder in your project directory.
    You will see: **`Sonan Pharmacy Setup 1.0.2.exe`**

---

## 💻 How to Run in Development Mode
To test changes without building the full installer:
```bash
npm run electron:dev
```

---

## 📡 Setup Instructions (After Installing)

### 1. Main Computer (The Server)
*   Install and open the app.
*   On the connection screen, verify the URL is `http://localhost:4000`.
*   Click **Connect**.
*   Go to **Admin Panel** -> **Data Management** -> **Migration** if you need to restore old data.

### 2. Staff Computers (Clients)
*   Install and open the app.
*   Click the **Network Icon** (or "Change Server") on the login screen.
*   Enter the IP address of the Main Computer.
    *   *Example:* `http://192.168.1.15:4000`
*   Click **Connect**.

---

## 🔑 Default Logins
| Role | Username | Password |
| :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` |
| **Pharmacist** | `pharmacist` | `user123` |
