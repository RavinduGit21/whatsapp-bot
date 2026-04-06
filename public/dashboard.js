const socket = io();
const orderList = document.getElementById('order-list');
const statPending = document.getElementById('stat-pending');
const statPreparing = document.getElementById('stat-preparing');
const statTotalAmount = document.getElementById('stat-total');

let orders = [];

// Fetch initial orders
async function fetchOrders() {
    try {
        const response = await fetch('/api/orders');
        orders = await response.json();
        renderOrders();
        updateStats();
    } catch (err) {
        console.error('Error fetching orders:', err);
    }
}

function updateStats() {
    statPending.innerText = orders.filter(o => o.status === 'Pending').length;
    statPreparing.innerText = orders.filter(o => o.status === 'Preparing').length;
    const total = orders.reduce((sum, o) => sum + parseFloat(o.total), 0);
    statTotalAmount.innerText = `රු. ${total.toFixed(2)}`;
}

function renderOrders() {
    orderList.innerHTML = '';
    orders.forEach(order => {
        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="order-header">
                <span class="order-id">ORDER #${order.id}</span>
                <span class="order-time">${new Date(order.timestamp).toLocaleTimeString()}</span>
            </div>
            <div class="customer-info">
                <h4>${order.customer_name}</h4>
                <p>📞 ${order.customer_number.split('@')[0]}</p>
            </div>
            <div class="items-list">
                <p>🛒 ${order.items}</p>
            </div>
            <div class="total-row">
                <span class="status-badge status-${order.status.toLowerCase()}">${order.status}</span>
                <span class="total-amount">රු. ${parseFloat(order.total).toFixed(2)}</span>
            </div>
            <div class="action-row">
                ${order.status === 'Pending' ? `<button onclick="updateStatus(${order.id}, 'Preparing')" class="btn btn-primary">Start Prep</button>` : ''}
                ${order.status === 'Preparing' ? `<button onclick="updateStatus(${order.id}, 'Completed')" class="btn btn-primary">Complete</button>` : ''}
                <button onclick="viewDetails(${order.id})" class="btn btn-secondary">Details</button>
            </div>
        `;
        orderList.appendChild(card);
    });
}

async function updateStatus(id, status) {
    try {
        await fetch(`/api/orders/${id}/status`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        });
        // Local update if needed, but socket will handle it anyway usually
        // For faster feedback:
        const order = orders.find(o => o.id === id);
        if (order) order.status = status;
        renderOrders();
        updateStats();
    } catch (err) {
        console.error('Error updating status:', err);
    }
}

function viewDetails(id) {
    const order = orders.find(o => o.id === id);
    const modal = document.getElementById('order-modal');
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
        <p><strong>Customer:</strong> ${order.customer_name}</p>
        <p><strong>Number:</strong> ${order.customer_number}</p>
        <p><strong>Items:</strong> ${order.items}</p>
        <p><strong>Order Time:</strong> ${new Date(order.timestamp).toLocaleString()}</p>
        <p><strong>Status:</strong> ${order.status}</p>
        <h3 style="margin-top:20px;">මුළු එකතුව (Total): රු. ${parseFloat(order.total).toFixed(2)}</h3>
    `;
    modal.style.display = 'flex';
}

// Socket Events
socket.on('new_order', (order) => {
    orders.unshift(order);
    renderOrders();
    updateStats();
    // Play a notification sound
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
    audio.play();
});

socket.on('order_status_updated', ({ id, status }) => {
    const order = orders.find(o => o.id === id);
    if (order) {
        order.status = status;
        renderOrders();
        updateStats();
    }
});

// Modal Logic
document.querySelector('.close-btn').addEventListener('click', () => {
    document.getElementById('order-modal').style.display = 'none';
});

// Tab Logic
window.addEventListener('load', () => {
    fetchOrders();

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            
            item.classList.add('active');
            const tabId = item.getAttribute('data-tab');
            document.getElementById(`${tabId}-tab`).classList.add('active');
            document.getElementById('top-title').innerText = item.innerText;
        });
    });
});
