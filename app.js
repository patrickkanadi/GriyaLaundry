const API_URL = "https://script.google.com/macros/s/AKfycbyqhUWHZIy1g-tGk8lHX51Ayf2byF6oK3-LsVo8lVpT7AReYmEi61GRhIwfBivlZfto/exec"; 
const DB_NAME = "GriyaLaundry_POS";
const DB_VERSION = 1;
let db;

let currentCashier = ""; let currentPin = ""; let currentShiftId = ""; let currentLoginTime = "";
let globalMenuData = []; let currentCategory = ""; let activeLaundryTickets = [];
let currentCart = []; let activeNumpadItem = null; let numpadValue = "0";
let activeSettlementTicket = null; window.masterDrawerBalance = 0; let isLoggingOut = false;

// INIT DB & LOGIN
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            db.createObjectStore("staff", { keyPath: "pin" });
            db.createObjectStore("menu", { keyPath: "itemId" });
            db.createObjectStore("settings", { keyPath: "key" });
            db.createObjectStore("orders", { keyPath: "orderId" });
            db.createObjectStore("active_shifts", { keyPath: "pin" }); 
            db.createObjectStore("cash_drops", { keyPath: "dropId" }); 
            db.createObjectStore("shift_reports", { keyPath: "shiftId" }); 
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    });
}

function attemptLogin() {
    const pin = document.getElementById("cashier-pin").value;
    db.transaction(["staff"], "readonly").objectStore("staff").get(pin).onsuccess = (e) => {
        const staff = e.target.result;
        if (staff) {
            currentCashier = staff.name; currentPin = staff.pin; currentShiftId = "SHF-" + Date.now(); currentLoginTime = new Date().toISOString();
            document.getElementById("login-screen").classList.add("hidden"); document.getElementById("pos-screen").classList.remove("hidden");
            document.getElementById("display-cashier").innerText = currentCashier;
            syncMasterData();
        } else { alert("Invalid PIN"); }
    };
}

// UI NAVIGATION
function switchWorkspace(type) {
    document.querySelectorAll('.ws-tab').forEach(b => b.classList.remove('active'));
    document.getElementById("main-workspace").classList.add("hidden");
    document.getElementById("active-tickets-workspace").classList.add("hidden");
    
    if (type === 'new') {
        document.getElementById("tab-new-order").classList.add("active");
        document.getElementById("main-workspace").classList.remove("hidden");
    } else {
        document.getElementById("tab-active-tickets").classList.add("active");
        document.getElementById("active-tickets-workspace").classList.remove("hidden");
        renderActiveTickets();
    }
}

// SYNC ENGINE (With Error Diagnostics)
async function syncMasterData() {
    if (!navigator.onLine) {
        if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Offline Mode";
        if(document.getElementById("login-network-text")) document.getElementById("login-network-text").innerText = "Offline Mode";
        if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#e74c3c";
        if(document.getElementById("login-network-dot")) document.getElementById("login-network-dot").style.backgroundColor = "#e74c3c";
        return;
    }
    
    if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Syncing...";
    if(document.getElementById("login-network-text")) document.getElementById("login-network-text").innerText = "Syncing...";
    if(document.getElementById("login-network-dot")) document.getElementById("login-network-dot").style.backgroundColor = "#f39c12";

    try {
        const response = await fetch(API_URL); 
        const result = await response.json();
        
        if (result.status === "Success") {
            window.masterDrawerBalance = result.masterDrawerBalance || 0; 
            
            const tx = db.transaction(["staff", "menu", "settings"], "readwrite");
            
            const staffStore = tx.objectStore("staff"); staffStore.clear(); result.data.staff.forEach(s => staffStore.add(s));
            const menuStore = tx.objectStore("menu"); menuStore.clear(); result.data.menu.forEach(m => menuStore.add(m));
            
            const settingsStore = tx.objectStore("settings"); settingsStore.clear(); 
            for (const [key, value] of Object.entries(result.data.settings)) { settingsStore.add({ key: key, value: value }); }
            
            globalMenuData = result.data.menu;
            activeLaundryTickets = result.data.activeLaundryOrders || [];
            
            if(document.getElementById("ticket-count")) document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
            
            if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Online & Synced";
            if(document.getElementById("login-network-text")) document.getElementById("login-network-text").innerText = "Database Ready ✅";
            if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#2ecc71";
            if(document.getElementById("login-network-dot")) document.getElementById("login-network-dot").style.backgroundColor = "#2ecc71";
            
            if (!document.getElementById("pos-screen").classList.contains("hidden")) {
                loadMenuUI(); renderActiveTickets();
            }
        } else {
            // Throw the exact error Google sent us back
            throw new Error(result.message || "Unknown Google Script Error");
        }
    } catch (e) { 
        // THIS WILL POP UP THE EXACT REASON IT IS FAILING
        alert("CRASH REPORT: " + e.message);
        
        if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Sync Failed"; 
        if(document.getElementById("login-network-text")) document.getElementById("login-network-text").innerText = "Sync Failed ❌";
        if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#e74c3c";
        if(document.getElementById("login-network-dot")) document.getElementById("login-network-dot").style.backgroundColor = "#e74c3c";
    }
}

// MENU & NUMPAD LOGIC
function loadMenuUI() {
    const categories = [...new Set(globalMenuData.map(i => i.category))];
    currentCategory = categories[0];
    const catContainer = document.getElementById("category-container"); catContainer.innerHTML = "";
    categories.forEach(cat => {
        const btn = document.createElement("button"); btn.className = `cat-btn ${cat === currentCategory ? "active" : ""}`; btn.innerText = cat;
        btn.onclick = () => { currentCategory = cat; document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); renderProductGrid(); };
        catContainer.appendChild(btn);
    });
    renderProductGrid();
}

function renderProductGrid() {
    const grid = document.getElementById("product-grid"); grid.innerHTML = "";
    globalMenuData.filter(i => i.category === currentCategory).forEach(item => {
        const card = document.createElement("div"); card.className = "product-card";
        card.innerHTML = `<h4>${item.name}</h4><p style="color:#7f8c8d; margin:5px 0;">Rp ${item.price.toLocaleString('id-ID')}</p>`;
        card.onclick = () => { if (item.inputMode === "DECIMAL") openNumpad(item); else addToCart(item, 1); };
        grid.appendChild(card);
    });
}

function openNumpad(item) { activeNumpadItem = item; numpadValue = "0"; document.getElementById("numpad-display").innerText = "0"; document.getElementById("numpad-modal").classList.remove("hidden"); }
function closeNumpad() { document.getElementById("numpad-modal").classList.add("hidden"); activeNumpadItem = null; }
function numpadPress(val) {
    if (val === 'DEL') { numpadValue = numpadValue.slice(0, -1) || "0"; }
    else if (val === '.') { if (!numpadValue.includes('.')) numpadValue += '.'; }
    else { numpadValue = numpadValue === "0" ? String(val) : numpadValue + val; }
    document.getElementById("numpad-display").innerText = numpadValue;
}
function confirmNumpad() {
    let qty = parseFloat(numpadValue);
    if (qty > 0) addToCart(activeNumpadItem, qty);
    closeNumpad();
}

// CART LOGIC
function addToCart(item, qty) {
    const existing = currentCart.find(i => i.itemId === item.itemId);
    if (existing) existing.qty += qty; else currentCart.push({ ...item, qty: qty, originalPrice: item.price });
    renderCart();
}

function renderCart() {
    const container = document.getElementById("cart-items"); container.innerHTML = "";
    let total = 0;
    currentCart.forEach(item => {
        const lineTotal = item.qty * item.price; total += lineTotal;
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        container.innerHTML += `<div class="cart-item"><div><span class="cart-qty">${qtyDisplay}</span> ${item.name}</div><strong>Rp ${lineTotal.toLocaleString('id-ID')}</strong></div>`;
    });
    document.getElementById("cart-total").innerText = `Rp ${total.toLocaleString('id-ID')}`;
    window.cartGrandTotal = total;
}
function clearCart() { currentCart = []; document.getElementById("cust-phone").value = ""; document.getElementById("cust-name").value = ""; renderCart(); }

// CHECKOUT LOGIC
function reviewOrder() {
    if (currentCart.length === 0) return alert("Cart is empty");
    document.getElementById("review-grandtotal").innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    document.getElementById("pay-deposit").value = window.cartGrandTotal; 
    calculateRemaining();
    document.getElementById("review-modal").classList.remove("hidden");
}

function calculateRemaining() {
    const deposit = Number(document.getElementById("pay-deposit").value) || 0;
    const remaining = Math.max(0, window.cartGrandTotal - deposit);
    document.getElementById("review-remaining").innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
}

function closeReview() { document.getElementById("review-modal").classList.add("hidden"); }

async function finalizeOrder(shouldPrint) {
    const deposit = Number(document.getElementById("pay-deposit").value) || 0;
    const payMethod = document.querySelector('input[name="pay-method"]:checked').value;
    const remaining = window.cartGrandTotal - deposit;
    
    const requiresProcessing = currentCart.some(i => i.workflow === "TICKET");
    let status = "Completed";
    if (requiresProcessing) status = "Processing"; 
    else if (remaining > 0) status = "Pending Debt"; 

    const orderPayload = {
        orderId: "ORD-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId,
        customerName: document.getElementById("cust-name").value || "Walk-in", customerPhone: document.getElementById("cust-phone").value || "-",
        orderStatus: status, items: currentCart, subtotal: window.cartGrandTotal, discounts: 0, grandTotal: window.cartGrandTotal,
        paymentMethod: payMethod, cashAmount: payMethod === 'Cash' ? deposit : 0, qrisAmount: payMethod === 'QRIS' ? deposit : 0,
        syncStatus: "Pending"
    };

    const txMenu = db.transaction(["menu"], "readwrite");
    const storeMenu = txMenu.objectStore("menu");
    currentCart.forEach(cartItem => {
        storeMenu.get(cartItem.itemId).onsuccess = (ev) => {
            const menuItem = ev.target.result;
            if (menuItem && menuItem.trackStock) {
                menuItem.currentStock = Math.max(0, menuItem.currentStock - cartItem.qty);
                storeMenu.put(menuItem);
            }
        };
    });

    db.transaction(["orders"], "readwrite").objectStore("orders").add(orderPayload);
    
    if (requiresProcessing) {
        activeLaundryTickets.unshift(orderPayload); 
        document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
    }

    if (shouldPrint) {
        await buildPrintableReceipt(orderPayload.orderId, orderPayload, deposit, remaining, payMethod);
        window.print(); 
    }
    
    clearCart(); closeReview(); renderProductGrid(); runBackgroundSync();
}

// ---------------------------------------------------------
// DYNAMIC SETTINGS & RECEIPT PRINTING
// ---------------------------------------------------------
async function getDynamicSettings() {
    return new Promise(res => {
        let req = db.transaction(["settings"], "readonly").objectStore("settings").getAll();
        req.onsuccess = e => { let s = {}; e.target.result.forEach(row => s[row.key] = row.value); res(s); };
    });
}

async function buildPrintableReceipt(orderId, order, deposit, remaining, payMethod) {
    const settings = await getDynamicSettings();
    const h1 = settings["Header_1"] || "GRIYA LAUNDRY"; 
    const h2 = settings["Header_2"] || ""; 
    const h3 = settings["Header_3"] || ""; 
    const f1 = settings["Footer_1"] || "TERIMA KASIH"; 
    const f2 = settings["Footer_2"] || ""; 
    const f3 = settings["Footer_3"] || ""; 
    
    const printArea = document.getElementById("printable-area"); 
    const dateStr = new Date().toLocaleString('id-ID');
    
    let itemsHtml = "";
    order.items.forEach(item => {
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        const lineTotal = item.qty * item.originalPrice;
        itemsHtml += `<div style="display:flex; justify-content:space-between; margin-bottom: 2px;"><span>${qtyDisplay}x ${item.name}</span><span>${lineTotal.toLocaleString('id-ID')}</span></div>`;
    });

    printArea.innerHTML = `
        <div style="text-align:center; margin-bottom:10px;">
            <h2 style="margin:0;">${h1}</h2>
            ${h2 ? `<div style="font-size:10px;">${h2}</div>` : ''}
            ${h3 ? `<div style="font-size:10px;">${h3}</div>` : ''}
            <div style="font-size:10px; margin-top:5px;">${dateStr}</div>
        </div>
        <div style="border-top:1px dashed #000; border-bottom:1px dashed #000; padding:5px 0; margin-bottom:5px; font-size: 11px;">
            <div>Order: ${orderId}</div>
            <div>Customer: ${order.customerName}</div>
            <div>Cashier: ${currentCashier}</div>
        </div>
        ${itemsHtml}
        <div style="border-top:1px dashed #000; margin-top:10px; padding-top:5px;">
            <div style="display:flex; justify-content:space-between; font-size:11px;"><span>Subtotal:</span><span>Rp ${order.subtotal.toLocaleString('id-ID')}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:14px; margin-top:5px; border-bottom: 1px solid #000; padding-bottom: 5px;"><span>TOTAL:</span><span>Rp ${order.grandTotal.toLocaleString('id-ID')}</span></div>
        </div>
        <div style="margin-top:5px; font-size:11px;">
            <div style="display:flex; justify-content:space-between;"><span>Paid (${payMethod}):</span><span>Rp ${deposit.toLocaleString('id-ID')}</span></div>
            ${remaining > 0 ? 
                `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-top: 5px;"><span>SISA TAGIHAN:</span><span>Rp ${remaining.toLocaleString('id-ID')}</span></div>` : 
                `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-top: 5px;"><span>STATUS:</span><span>LUNAS</span></div>`}
        </div>
        <div style="text-align:center; margin-top:15px; font-weight:bold; font-size: 12px;">${f1}</div>
        ${f2 ? `<div style="text-align:center; margin-top:2px; font-size: 10px;">${f2}</div>` : ''}
        ${f3 ? `<div style="text-align:center; margin-top:2px; font-size: 10px;">${f3}</div>` : ''}
    `;
}

// KANBAN / ACTIVE TICKETS LOGIC
function renderActiveTickets() {
    const grid = document.getElementById("ticket-grid-container"); grid.innerHTML = "";
    activeLaundryTickets.forEach((ticket, index) => {
        const isReady = ticket.orderStatus === "Ready for Pickup";
        const totalPaid = (ticket.cashAmount || 0) + (ticket.qrisAmount || 0);
        const remaining = ticket.grandTotal - totalPaid;

        let receiptText = ticket.readableReceipt || "";
        if (!receiptText && ticket.items) {
            receiptText = ticket.items.map(i => `${i.qty % 1 !== 0 ? i.qty.toFixed(2) : i.qty}x ${i.name}`).join('\n');
        }

        grid.innerHTML += `
            <div class="ticket-card ${isReady ? 'ready' : ''}">
                <div class="ticket-header"><span>${ticket.customerName}</span> <span style="color:#7f8c8d; font-size:12px;">${ticket.orderId}</span></div>
                <div style="font-size:14px; margin-bottom:10px; white-space:pre-wrap;">${receiptText}</div>
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:10px; border-top:1px dashed #ddd; padding-top:5px;">
                    <span>Remaining Due:</span> <strong style="color:#e74c3c;">Rp ${remaining.toLocaleString('id-ID')}</strong>
                </div>
                ${!isReady ? `<button class="ticket-btn" style="background:#f39c12;" onclick="markTicketReady('${ticket.orderId}')">Mark Ready</button>` 
                           : `<button class="ticket-btn" style="background:#2ecc71;" onclick="openSettlement('${ticket.orderId}', ${remaining})">Pick Up & Settle</button>`}
            </div>
        `;
    });
}

function markTicketReady(orderId) {
    const ticket = activeLaundryTickets.find(t => t.orderId === orderId);
    if (ticket) {
        ticket.orderStatus = "Ready for Pickup";
        ticket.syncStatus = "Pending";
        db.transaction(["orders"], "readwrite").objectStore("orders").put(ticket);
        renderActiveTickets(); runBackgroundSync();
    }
}

function openSettlement(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    document.getElementById("settle-amount").innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    document.getElementById("settlement-modal").classList.remove("hidden");
}

function confirmSettlement() {
    if (!activeSettlementTicket) return;
    const method = document.querySelector('input[name="settle-method"]:checked').value;
    const totalPaidBefore = (activeSettlementTicket.cashAmount || 0) + (activeSettlementTicket.qrisAmount || 0);
    const remaining = activeSettlementTicket.grandTotal - totalPaidBefore;

    if (method === 'Cash') activeSettlementTicket.cashAmount += remaining;
    else activeSettlementTicket.qrisAmount += remaining;
    
    activeSettlementTicket.orderStatus = "Completed";
    activeSettlementTicket.syncStatus = "Pending";
    
    db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
    
    activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
    document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
    
    document.getElementById("settlement-modal").classList.add("hidden");
    renderActiveTickets(); runBackgroundSync();
}

// UTILITIES: DRAWER, SHIFT REPORT & SYNC
function calculateLiveDrawer(callback) {
    let liveDrawer = window.masterDrawerBalance || 0; 
    let tx = db.transaction(["orders", "cash_drops"], "readonly");
    let ordersReq = tx.objectStore("orders").getAll();
    let dropReq = tx.objectStore("cash_drops").getAll();
    tx.oncomplete = () => {
        ordersReq.result.forEach(o => { if (o.syncStatus === "Pending" && o.orderStatus !== "Voided") liveDrawer += (o.cashAmount || 0); });
        dropReq.result.forEach(d => { if (d.syncStatus === "Pending") liveDrawer -= (d.toAdmin + d.toBank); });
        callback(liveDrawer);
    };
}

function openCashDrop(forLogout = false) {
    isLoggingOut = forLogout;
    document.getElementById("cash-drop-title").innerText = isLoggingOut ? "🔒 End of Shift Cash Log" : "🏦 Store Money";
    document.getElementById("btn-drop-cancel").innerText = isLoggingOut ? "Cancel Logout" : "Cancel";
    document.getElementById("btn-drop-confirm").innerText = isLoggingOut ? "Confirm & Logout" : "Save Record";
    document.getElementById("drop-admin").value = 0; document.getElementById("drop-bank").value = 0; document.getElementById("drop-notes").value = "";
    
    calculateLiveDrawer((liveAmount) => {
        document.getElementById("live-drawer-display").innerText = `Rp ${liveAmount.toLocaleString('id-ID')}`;
        document.getElementById("cash-drop-modal").classList.remove("hidden");
    });
}

function submitCashDrop() {
    const adminAmt = Number(document.getElementById("drop-admin").value) || 0;
    const bankAmt = Number(document.getElementById("drop-bank").value) || 0;
    const notes = document.getElementById("drop-notes").value || (isLoggingOut ? "Shift End" : "Mid-shift Drop");
    
    calculateLiveDrawer((liveAmount) => {
        const leftInDrawer = liveAmount - adminAmt - bankAmt;
        const payload = { dropId: "DRP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, toAdmin: adminAmt, toBank: bankAmt, leftInDrawer: leftInDrawer, notes: notes, syncStatus: "Pending" };
        db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").add(payload);
        document.getElementById("cash-drop-modal").classList.add("hidden"); runBackgroundSync();
        if (isLoggingOut) executeFinalLogout(leftInDrawer); else alert(`Cash Drop Logged!\nLeft in Drawer: Rp ${leftInDrawer.toLocaleString('id-ID')}`);
    });
}

function openShiftReport() {
    let totalCustomers = 0; let totalOmset = 0; let totalCash = 0; let totalQris = 0; let foodSummary = {};
    db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
        const validOrders = e.target.result.filter(o => o.shiftId === currentShiftId);
        validOrders.forEach(o => {
            totalCustomers++; totalOmset += o.grandTotal;
            totalCash += (o.cashAmount || 0); totalQris += (o.qrisAmount || 0);
            if (o.items) o.items.forEach(i => { if(!foodSummary[i.name]) foodSummary[i.name] = 0; foodSummary[i.name] += i.qty; });
        });
        calculateLiveDrawer((liveDrawer) => {
            document.getElementById("shift-customers").innerText = totalCustomers + " Customers";
            document.getElementById("shift-omset").innerText = `Rp ${totalOmset.toLocaleString('id-ID')} Omset`;
            document.getElementById("shift-net").innerText = `Rp ${liveDrawer.toLocaleString('id-ID')} Drawer`;
            document.getElementById("shift-report-modal").classList.remove("hidden");
            window.currentShiftData = { totalCustomers, totalOmset, totalCash, totalQris, net: liveDrawer, foodSummary };
        });
    };
}

function initiateLogoutSequence() { document.getElementById("shift-report-modal").classList.add("hidden"); openCashDrop(true); }

async function executeFinalLogout(netCash) { 
    const data = window.currentShiftData;
    const shiftPayload = {
        shiftId: currentShiftId, timestamp: new Date().toISOString(), cashier: currentCashier, loginTime: currentLoginTime, logoutTime: new Date().toISOString(), 
        totalCustomers: data.totalCustomers, totalOmset: data.totalOmset, totalCash: data.totalCash, totalQris: data.totalQris, totalExpenses: 0, netCash: netCash,
        foodSummary: data.foodSummary, syncStatus: "Pending"
    };

    db.transaction(["shift_reports"], "readwrite").objectStore("shift_reports").add(shiftPayload);
    db.transaction(["active_shifts"], "readwrite").objectStore("active_shifts").delete(currentPin); 
    if (navigator.onLine) {
        if(document.getElementById("network-text")) document.getElementById("network-text").innerText = `Sending Report...`;
        try {
            let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncShiftReport", data: shiftPayload }) });
            if ((await r.json()).status === "Success") { db.transaction(["shift_reports"], "readwrite").objectStore("shift_reports").delete(shiftPayload.shiftId); }
        } catch(e) {}
    }
    window.location.reload(); 
}

function lockScreen() { window.location.reload(); }

async function runBackgroundSync() {
    if (!navigator.onLine) return;
    let tx = db.transaction(["orders", "cash_drops", "shift_reports"], "readonly");
    let orders = await new Promise(res => tx.objectStore("orders").getAll().onsuccess = e => res(e.target.result));
    for (const order of orders) {
        if (order.syncStatus === "Pending") {
            try { 
                let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncOrder", data: order }) });
                if ((await r.json()).status === "Success") { order.syncStatus = "Synced"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); } 
            } catch(e) {}
        }
    }
    let drops = await new Promise(res => tx.objectStore("cash_drops").getAll().onsuccess = e => res(e.target.result));
    for (const drop of drops) {
        if (drop.syncStatus === "Pending") {
            try { let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncCashDrop", data: drop }) }); if ((await r.json()).status === "Success") { drop.syncStatus = "Synced"; db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").put(drop); } } catch(e) {}
        }
    }
    let reports = await new Promise(res => tx.objectStore("shift_reports").getAll().onsuccess = e => res(e.target.result));
    for (const report of reports) {
        if (report.syncStatus === "Pending") {
            try { let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncShiftReport", data: report }) }); if ((await r.json()).status === "Success") { db.transaction(["shift_reports"], "readwrite").objectStore("shift_reports").delete(report.shiftId); } } catch(e) {}
        }
    }
}

window.onload = async () => { 
    await initDB(); 
    await syncMasterData(); // <-- I accidentally forgot this line earlier!
    window.setInterval(runBackgroundSync, 15000); 
};
