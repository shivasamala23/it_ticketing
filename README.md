# Zunax IT Support - Cross-Platform Mobile Application (Android & iOS)

A modern, high-performance cross-platform mobile application for Android and iOS integrated with the Odoo IT Ticketing module (`zunax_it_ticketing`).

---

## 📱 Mobile App Features

1. **Odoo Employee Authentication**:
   - Authenticates using Odoo credentials (`Server URL`, `Database Name`, `Username / Work Email`, `Password`).
   - Automatically resolves and logs in the corresponding **Odoo Employee** (`hr.employee` / `hr.employee.public`).
   - Secure local session persistence & auto-reconnect.

2. **Raise New IT Tickets**:
   - Select predefined IT issue categories/subjects (`it.ticket.subject`).
   - Select IT support department (`it.department`).
   - Select priority level (*Low*, *Medium*, *High*, *Urgent*).
   - Enter detailed issue description & auto-fill work contact info.
   - Instantly creates an `it.ticket` record in your Odoo database, auto-generates the sequence number (`IT000xx`), auto-routes to department staff, and triggers Odoo notification emails.

3. **Real-time Operations & Stage Tracking**:
   - Interactive Stepper Timeline: **Draft** ➔ **New** ➔ **In Progress** ➔ **Resolved** / **Cancelled**.
   - Filter tickets by status (*All*, *New*, *In Progress*, *Resolved*, *Cancelled*).
   - Search by ticket sequence number or issue title.
   - Pull-to-refresh to sync stage updates from Odoo support staff in real time.

4. **Ticket Chatter & Cancellation**:
   - View ticket activity logs and communication history (`mail.message`).
   - Post message comments back to Odoo support staff.
   - Cancel tickets with cancellation reasons synced directly to Odoo `cancellation_reason` and setting stage to `cancelled`.

---

## 🚀 How to Run the App

### Option A: Immediate Browser / Mobile Web View
1. Open `index.html` directly in any web browser (Chrome, Safari, Edge).
2. Or serve locally with any static web server:
   ```bash
   npx serve .
   ```
3. Enter your Odoo server details:
   - **Odoo Server URL**: `http://localhost:8069` (or `http://192.168.x.x:8069`)
   - **Database Name**: `zunax_db` (or your Odoo DB name)
   - **Username**: Employee work email or username
   - **Password**: Employee password

*Tip: Check "Use Offline Demo / Test Mode" on the login screen if you want to test the app UI without connecting to an active Odoo instance.*

---

### Option B: Build Native Android App (`.apk` / `.aab`)
1. Ensure Node.js is installed.
2. Install Capacitor CLI:
   ```bash
   npm install
   npx cap add android
   npx cap copy
   ```
3. Open project in Android Studio:
   ```bash
   npx cap open android
   ```
4. Build APK: In Android Studio, go to **Build** ➔ **Build Bundle(s) / APK(s)** ➔ **Build APK(s)**.

---

### Option C: Build Native iOS App (`.ipa` / Xcode)
1. On a macOS machine with Xcode installed:
   ```bash
   npm install
   npx cap add ios
   npx cap copy
   ```
2. Open in Xcode:
   ```bash
   npx cap open ios
   ```
3. Select your iOS signing team, select target device (Simulator or connected iPhone), and hit **Run** or **Archive** for App Store submission.

---

## 🛠️ Odoo Backend Module Compatibility

This mobile app is built specifically to sync with:
- **Module Name**: `zunax_it_ticketing`
- **Tested Odoo Versions**: Odoo 18.0, 17.0, 16.0
- **Target Models**:
  - `it.ticket`
  - `it.department`
  - `it.ticket.subject`
  - `it.cancellation.reason`
  - `hr.employee` / `hr.employee.public`
  - `res.users`
  - `mail.message`
