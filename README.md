# 🍽️ Deluxe Flavors - WhatsApp Restaurant Bot & Admin Dashboard

A professional, high-end WhatsApp bot and administration system for your restaurant. 

## 🚀 Features

- **Automated WhatsApp Responses**: Greets customers, shows the menu, and handles orders.
- **Visual Menu**: Automatically sends a professional menu image to customers.
- **Real-time Order Dashboard**: A sleek, premium web interface for the restaurant owner to see and manage orders in real-time.
- **Sound Notifications**: Get alerted immediately when a new order arrives.
- **Persistent Storage**: All orders are securely saved in a local SQLite database.

## 🛠️ How to Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run the Application**:
   ```bash
   node index.js
   ```

3. **Scan QR Code**:
   - A QR code will appear in your terminal.
   - Open WhatsApp on your phone -> Settings -> Linked Devices -> Link a Device.
   - Scan the terminal's QR code.

4. **Access the Admin Dashboard**:
   - Open your browser and go to: `http://localhost:3000`

## 💬 Bot Commands for Customers

- **Hi / Hello**: Initial greeting and instructions.
- **Menu**: View the text and image-based menu.
- **Order [Item ID]**: Add an item to the shopping cart (e.g., `Order 1`).
- **Order**: View current cart.
- **Confirm**: Finalize and place the order.
- **Help**: List all available commands.

## 📁 Project Structure

- `index.js`: The "brain" of the system (Bot + Server).
- `menu.json`: The list of your dishes and prices.
- `menu.png`: The visual menu image sent to customers.
- `public/`: The source code for the premium admin dashboard.
- `orders.db`: Local database containing all order history.

---
*Powered by Antigravity AI*
