const API_URL = "https://script.google.com/macros/s/AKfycbyqhUWHZIy1g-tGk8lHX51Ayf2byF6oK3-LsVo8lVpT7AReYmEi61GRhIwfBivlZfto/exec"; 
const DB_NAME = "GriyaLaundry_POS";
const DB_VERSION = 5; 
let db;

let currentCashier = ""; let currentPin = ""; let currentShiftId = ""; let currentLoginTime = "";
let globalMenuData = []; let currentCategory = ""; let activeLaundryTickets = [];
let currentCart = []; let activeNumpadItem = null; let numpadValue = "0";
let activeSettlementTicket = null; window.masterDrawerBalance = 0; let isLoggingOut = false;
let currentVoidTarget = { type: null, id: null };
let isMenuLocked = true; let isSyncing = false; 
let activeCustomerProfile = null; let activeCoinPrice = 10000;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            if (!db.objectStoreNames.contains("staff")) db.createObjectStore("staff", { keyPath: "pin" });
            if (!db.objectStoreNames.contains("menu")) db.createObjectStore("menu", { keyPath: "itemId" });
            if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
            if (!db.objectStoreNames.contains("orders")) db.createObjectStore("orders", { keyPath: "orderId" });
            if (!db.objectStoreNames.contains("active_shifts")) db.createObjectStore("active_shifts", { keyPath: "pin" }); 
            if (!db.objectStoreNames.contains("cash_drops")) db.createObjectStore("cash_drops", { keyPath: "dropId" }); 
            if (!db.objectStoreNames.contains("shift_reports")) db.createObjectStore("shift_reports", { keyPath: "shiftId" }); 
            if (!db.objectStoreNames.contains("expenses")) db.createObjectStore("expenses", { keyPath: "expenseId" });
            if (!db.objectStoreNames.contains("members")) db.createObjectStore("members", { keyPath: "phone" });
            if (!db.objectStoreNames.contains("unsynced_members")) db.createObjectStore("unsynced_members", { keyPath: "phone" });
            if (!db.objectStoreNames.contains("expense_categories")) db.createObjectStore("expense_categories", { keyPath: "name" });
            if (!db.objectStoreNames.contains("void_requests")) db.createObjectStore("void_requests", { keyPath: "id" });
            if (!db.objectStoreNames.contains("local_shift_history")) db.createObjectStore("local_shift_history", { keyPath: "shiftId" });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
    });
}

function attemptLogin() {
    const pin = document.getElementById("cashier-pin").value;
    db.transaction(["staff"], "readonly").objectStore("staff").get(pin).onsuccess = (e) => {
        const staff = e.target.result;
        if (staff) {
            db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").get(pin).onsuccess = (shiftReq) => {
                const activeShift = shiftReq.target.result;
                currentCashier = staff.name; currentPin = staff.pin;
                if (activeShift) { currentShiftId = activeShift.shiftId; currentLoginTime = activeShift.loginTime; } 
                else {
                    currentShiftId = "SHF-" + Date.now(); currentLoginTime = new Date().toISOString();
                    db.transaction(["active_shifts"], "readwrite").objectStore("active_shifts").put({pin: pin, shiftId: currentShiftId, loginTime: currentLoginTime});
                }
                document.getElementById("login-screen").classList.add("hidden"); document.getElementById("pos-screen").classList.remove("hidden");
                document.getElementById("display-cashier").innerText = currentCashier;
                syncMasterData(); lockMenu(); 
            };
        } else { alert("Invalid PIN"); }
    };
}

function switchWorkspace(type) {
    document.querySelectorAll('.ws-tab').forEach(b => b.classList.remove('active'));
    document.getElementById("main-workspace").classList.add("hidden"); document.getElementById("active-tickets-workspace").classList.add("hidden");
    if (type === 'new') { document.getElementById("tab-new-order").classList.add("active"); document.getElementById("main-workspace").classList.remove("hidden"); } 
    else { document.getElementById("tab-active-tickets").classList.add("active"); document.getElementById("active-tickets-workspace").classList.remove("hidden"); renderActiveTickets(); }
}

function lockMenu() {
    isMenuLocked = true; activeCustomerProfile = null; document.getElementById("glass-overlay").style.opacity = "1"; document.getElementById("glass-overlay").style.pointerEvents = "auto";
    document.getElementById("cust-phone").value = ""; document.getElementById("cust-name").value = ""; currentCart = []; renderCart();
    document.getElementById("promo-indicator").classList.add("hidden");
}

function unlockMenu(isGuest) {
    if (isGuest) { document.getElementById("cust-phone").value = ""; document.getElementById("cust-name").value = "Walk-in"; activeCustomerProfile = null; } 
    else {
        const phone = document.getElementById("cust-phone").value.trim();
        if (phone.length < 5) return alert("Please enter a valid WhatsApp number.");
    }
    isMenuLocked = false; document.getElementById("glass-overlay").style.opacity = "0"; setTimeout(() => { document.getElementById("glass-overlay").style.pointerEvents = "none"; }, 300);
}

async function manualPushSync() {
    if (!navigator.onLine) return alert("You are offline!");
    document.getElementById("network-text").innerText = "Pushing Data..."; document.getElementById("network-dot").style.backgroundColor = "#f39c12";
    await runBackgroundSync(); document.getElementById("network-text").innerText = "Pulling Data..."; await syncMasterData(); alert("Database Synced!");
}

async function syncMasterData() {
    if (!navigator.onLine) {
        if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Offline Mode";
        if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#e74c3c"; return;
    }
    if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Syncing...";
    if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#f39c12";

    try {
        const response = await fetch(API_URL); const result = await response.json();
        if (result.status === "Success") {
            window.masterDrawerBalance = result.masterDrawerBalance || 0; 
            const tx = db.transaction(["staff", "menu", "settings", "members", "expense_categories"], "readwrite");
            
            const staffStore = tx.objectStore("staff"); staffStore.clear(); result.data.staff.forEach(s => staffStore.add(s));
            const menuStore = tx.objectStore("menu"); menuStore.clear(); result.data.menu.forEach(m => menuStore.add(m));
            const memStore = tx.objectStore("members"); memStore.clear(); result.data.members.forEach(m => memStore.add(m));
            const expCatStore = tx.objectStore("expense_categories"); expCatStore.clear(); 
            if(result.data.expenseCategories) result.data.expenseCategories.forEach(c => expCatStore.add({name: c}));
            const settingsStore = tx.objectStore("settings"); settingsStore.clear(); 
            for (const [key, value] of Object.entries(result.data.settings)) { settingsStore.add({ key: key, value: value }); }
            if (result.data.authStatuses) processVoidApprovals(result.data.authStatuses);

            globalMenuData = result.data.menu; activeLaundryTickets = result.data.activeLaundryOrders || [];
            
            let cItem = globalMenuData.find(i => String(i.category).toLowerCase().includes("coin") || String(i.name).toLowerCase().includes("koin"));
            if(cItem) activeCoinPrice = cItem.price;

            if(document.getElementById("ticket-count")) document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
            if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Online & Synced";
            if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#2ecc71";
            if (!document.getElementById("pos-screen").classList.contains("hidden")) { loadMenuUI(); renderActiveTickets(); populateMemberDatalist(); }
        } else { throw new Error(result.message); }
    } catch (e) { 
        if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Sync Failed"; 
        if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#e74c3c";
    }
}

function populateMemberDatalist() {
    const list = document.getElementById("member-list"); list.innerHTML = "";
    db.transaction(["members"], "readonly").objectStore("members").getAll().onsuccess = (e) => { e.target.result.forEach(member => { const opt = document.createElement("option"); opt.value = member.phone; opt.innerText = member.name; list.appendChild(opt); }); };
}

document.getElementById("cust-phone").addEventListener("input", (e) => {
    const phone = e.target.value.trim(); activeCustomerProfile = null; document.getElementById("promo-indicator").classList.add("hidden");
    if(phone.length > 4) { 
        db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (res) => { 
            if(res.target.result) {
                activeCustomerProfile = res.target.result; document.getElementById("cust-name").value = activeCustomerProfile.name; 
                if (activeCustomerProfile.freeCoins > 0) {
                    document.getElementById("promo-indicator").innerText = `🎁 ${activeCustomerProfile.freeCoins} Promo Coins!`;
                    document.getElementById("promo-indicator").classList.remove("hidden");
                }
            }
        }; 
    }
});

function saveMemberToDB(phone, name) {
    if(!phone) return; 
    db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (e) => {
        let mem = e.target.result || { phone: phone, name: name, koinBalance: 0, freeCoins: 0 }; mem.name = name;
        db.transaction(["members"], "readwrite").objectStore("members").put(mem);
        db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").put(mem);
    };
}

function loadMenuUI() {
    const categories = [...new Set(globalMenuData.map(i => i.category))]; currentCategory = categories[0];
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
        card.innerHTML = `<div><h4 style="margin-top:0;">${item.name}</h4></div> <div class="price-badge">Rp ${item.price.toLocaleString('id-ID')}</div>`;
        card.onclick = () => { if(isMenuLocked) return; if (item.inputMode === "DECIMAL") openNumpad(item); else addToCart(item, 1); };
        grid.appendChild(card);
    });
}

function openNumpad(item) { activeNumpadItem = item; numpadValue = "0"; document.getElementById("numpad-display").innerText = "0"; document.getElementById("numpad-modal").classList.remove("hidden"); }
function closeNumpad() { document.getElementById("numpad-modal").classList.add("hidden"); activeNumpadItem = null; }
function numpadPress(val) {
    if (val === 'DEL') { numpadValue = numpadValue.slice(0, -1) || "0"; } else if (val === '.') { if (!numpadValue.includes('.')) numpadValue += '.'; } else { numpadValue = numpadValue === "0" ? String(val) : numpadValue + val; }
    document.getElementById("numpad-display").innerText = numpadValue;
}
function confirmNumpad() { let qty = parseFloat(numpadValue); if (qty > 0) addToCart(activeNumpadItem, qty); closeNumpad(); }

function addToCart(item, qty) {
    const existing = currentCart.find(i => i.itemId === item.itemId);
    if (existing) existing.qty += qty; else currentCart.push({ ...item, qty: qty, originalPrice: item.price });
    renderCart();
}

function renderCart() {
    const container = document.getElementById("cart-items"); container.innerHTML = ""; let total = 0;
    currentCart.forEach(item => {
        const lineTotal = item.qty * item.price; total += lineTotal; const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        container.innerHTML += `<div class="cart-item"><div><span class="cart-qty">${qtyDisplay}</span> ${item.name}</div><strong>Rp ${lineTotal.toLocaleString('id-ID')}</strong></div>`;
    });
    document.getElementById("cart-total").innerText = `Rp ${total.toLocaleString('id-ID')}`; window.cartSubtotal = total; window.cartGrandTotal = total;
}
function clearCart() { lockMenu(); }

function reviewOrder() {
    if (currentCart.length === 0) return alert("Cart is empty");
    
    let totalCoinsInCart = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    
    if (activeCustomerProfile && activeCustomerProfile.freeCoins > 0 && totalCoinsInCart > 0) {
        document.getElementById("promo-section").classList.remove("hidden");
        document.getElementById("promo-text").innerText = `You have ${activeCustomerProfile.freeCoins} available. Max to use now: ${Math.min(activeCustomerProfile.freeCoins, totalCoinsInCart)}`;
        document.getElementById("redeem-coins").max = Math.min(activeCustomerProfile.freeCoins, totalCoinsInCart);
        document.getElementById("redeem-coins").value = 0;
    } else {
        document.getElementById("promo-section").classList.add("hidden"); document.getElementById("redeem-coins").value = 0;
    }

    document.getElementById("pay-cash").value = 0; document.getElementById("pay-qris").value = 0; document.getElementById("pay-hotel").value = 0;
    document.getElementById("pay-tamu-paid").value = 0; document.getElementById("pay-tamu-piutang").value = 0; document.getElementById("pay-free").value = 0;
    
    calculateRemaining(); 
    
    // Auto-fill cash with the final grand total
    document.getElementById("pay-cash").value = window.cartGrandTotal;
    calculateRemaining();
    
    document.getElementById("review-modal").classList.remove("hidden");
}

function calculateRemaining() {
    let redeemCount = Number(document.getElementById("redeem-coins").value) || 0;
    let totalCoinsInCart = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    
    if (redeemCount > totalCoinsInCart) { redeemCount = totalCoinsInCart; document.getElementById("redeem-coins").value = redeemCount; }
    if (activeCustomerProfile && redeemCount > activeCustomerProfile.freeCoins) { redeemCount = activeCustomerProfile.freeCoins; document.getElementById("redeem-coins").value = redeemCount; }

    window.cartDiscount = redeemCount * activeCoinPrice;
    window.cartGrandTotal = Math.max(0, window.cartSubtotal - window.cartDiscount);

    document.getElementById("review-subtotal").innerText = `Rp ${window.cartSubtotal.toLocaleString('id-ID')}`;
    document.getElementById("review-discount").innerText = `- Rp ${window.cartDiscount.toLocaleString('id-ID')}`;
    document.getElementById("review-grandtotal").innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;

    const c = Number(document.getElementById("pay-cash").value) || 0; const q = Number(document.getElementById("pay-qris").value) || 0;
    const h = Number(document.getElementById("pay-hotel").value) || 0; const tp = Number(document.getElementById("pay-tamu-paid").value) || 0;
    const tu = Number(document.getElementById("pay-tamu-piutang").value) || 0; const f = Number(document.getElementById("pay-free").value) || 0;
    
    const totalAccounted = c + q + h + tp + tu + f;
    const remaining = Math.max(0, window.cartGrandTotal - totalAccounted);
    document.getElementById("review-remaining").innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
}

function closeReview() { document.getElementById("review-modal").classList.add("hidden"); }

async function finalizeOrder(shouldPrint) {
    const cash = Number(document.getElementById("pay-cash").value) || 0; const qris = Number(document.getElementById("pay-qris").value) || 0;
    const hotel = Number(document.getElementById("pay-hotel").value) || 0; const tp = Number(document.getElementById("pay-tamu-paid").value) || 0;
    const tu = Number(document.getElementById("pay-tamu-piutang").value) || 0; const free = Number(document.getElementById("pay-free").value) || 0;
    const redeemCount = Number(document.getElementById("redeem-coins").value) || 0;
    
    const totalAccounted = cash + qris + hotel + tp + tu + free; const remaining = window.cartGrandTotal - totalAccounted;
    
    let payMethods = [];
    if(cash > 0) payMethods.push("Cash"); if(qris > 0) payMethods.push("QRIS"); if(hotel > 0) payMethods.push("Hotel"); if(tp > 0) payMethods.push("Tamu(Lunas)"); if(tu > 0) payMethods.push("Tamu(Kamar)"); if(free > 0) payMethods.push("Free");
    const payString = payMethods.length > 0 ? payMethods.join("+") : "Unpaid";

    const custPhone = document.getElementById("cust-phone").value.trim(); const custName = document.getElementById("cust-name").value.trim() || "Walk-in";
    if(custPhone) saveMemberToDB(custPhone, custName);

    const requiresProcessing = currentCart.some(i => i.workflow === "TICKET");
    let status = "Completed"; if (requiresProcessing) status = "Processing"; else if (remaining > 0 || tu > 0) status = "Pending Debt"; 

    let totalCoinsInCart = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    let coinsEarned = Math.max(0, totalCoinsInCart - redeemCount);

    const orderPayload = {
        orderId: "ORD-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId,
        customerName: custName, customerPhone: custPhone || "-", orderStatus: status, items: currentCart, subtotal: window.cartSubtotal, discounts: window.cartDiscount, grandTotal: window.cartGrandTotal,
        paymentMethod: payString, cashAmount: cash, qrisAmount: qris, hotelAmount: hotel, tamuPaidAmount: tp, tamuPiutangAmount: tu, freeAmount: free, remainingDue: remaining,
        coinsEarned: coinsEarned, coinsRedeemed: redeemCount, syncStatus: "Pending" 
    };

    const txMenu = db.transaction(["menu"], "readwrite"); const storeMenu = txMenu.objectStore("menu");
    currentCart.forEach(cartItem => {
        storeMenu.get(cartItem.itemId).onsuccess = (ev) => {
            const menuItem = ev.target.result;
            if (menuItem && menuItem.trackStock) { menuItem.currentStock = Math.max(0, menuItem.currentStock - cartItem.qty); storeMenu.put(menuItem); }
        };
    });

    db.transaction(["orders"], "readwrite").objectStore("orders").add(orderPayload);
    
    if (requiresProcessing) {
        activeLaundryTickets.unshift(orderPayload); document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
    }

    if (shouldPrint) { await buildPrintableReceipt(orderPayload.orderId, orderPayload, totalAccounted, remaining, payString); window.print(); }
    closeReview(); lockMenu(); renderProductGrid(); runBackgroundSync();
}

async function getDynamicSettings() { return new Promise(res => { let req = db.transaction(["settings"], "readonly").objectStore("settings").getAll(); req.onsuccess = e => { let s = {}; e.target.result.forEach(row => s[row.key] = row.value); res(s); }; }); }

async function buildPrintableReceipt(orderId, order, deposit, remaining, payMethod) {
    const settings = await getDynamicSettings();
    const h1 = settings["Header_1"] || "GRIYA LAUNDRY"; const h2 = settings["Header_2"] || ""; const h3 = settings["Header_3"] || ""; 
    const f1 = settings["Footer_1"] || "TERIMA KASIH"; const f2 = settings["Footer_2"] || ""; const f3 = settings["Footer_3"] || ""; 
    const printArea = document.getElementById("printable-area"); const dateStr = new Date().toLocaleString('id-ID');
    
    let itemsHtml = "";
    order.items.forEach(item => {
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty; const lineTotal = item.qty * item.originalPrice;
        itemsHtml += `<div style="display:flex; justify-content:space-between; margin-bottom: 2px;"><span>${qtyDisplay}x ${item.name}</span><span>${lineTotal.toLocaleString('id-ID')}</span></div>`;
    });
    if (order.discounts > 0) itemsHtml += `<div style="display:flex; justify-content:space-between; margin-bottom: 2px; color:#e74c3c;"><span>[PROMO] Free Coin</span><span>- ${order.discounts.toLocaleString('id-ID')}</span></div>`;

    printArea.innerHTML = `
        <div style="text-align:center; margin-bottom:10px;"><h2 style="margin:0;">${h1}</h2>${h2 ? `<div style="font-size:10px;">${h2}</div>` : ''}${h3 ? `<div style="font-size:10px;">${h3}</div>` : ''}<div style="font-size:10px; margin-top:5px;">${dateStr}</div></div>
        <div style="border-top:1px dashed #000; border-bottom:1px dashed #000; padding:5px 0; margin-bottom:5px; font-size: 11px;"><div>Order: ${orderId}</div><div>Customer: ${order.customerName}</div><div>Cashier: ${currentCashier}</div></div>
        ${itemsHtml}
        <div style="border-top:1px dashed #000; margin-top:10px; padding-top:5px;">
            <div style="display:flex; justify-content:space-between; font-size:11px;"><span>Subtotal:</span><span>Rp ${order.subtotal.toLocaleString('id-ID')}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:14px; margin-top:5px; border-bottom: 1px solid #000; padding-bottom: 5px;"><span>TOTAL:</span><span>Rp ${order.grandTotal.toLocaleString('id-ID')}</span></div>
        </div>
        <div style="margin-top:5px; font-size:11px;">
            <div style="display:flex; justify-content:space-between;"><span>Accounted (${payMethod}):</span><span>Rp ${deposit.toLocaleString('id-ID')}</span></div>
            ${remaining > 0 || order.tamuPiutangAmount > 0 ? `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-top: 5px;"><span>PIUTANG/SISA:</span><span>Rp ${(remaining + order.tamuPiutangAmount).toLocaleString('id-ID')}</span></div>` : `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-top: 5px;"><span>STATUS:</span><span>LUNAS</span></div>`}
        </div>
        <div style="text-align:center; margin-top:15px; font-weight:bold; font-size: 12px;">${f1}</div>${f2 ? `<div style="text-align:center; margin-top:2px; font-size: 10px;">${f2}</div>` : ''}${f3 ? `<div style="text-align:center; margin-top:2px; font-size: 10px;">${f3}</div>` : ''}
    `;
}

function renderActiveTickets() {
    const grid = document.getElementById("ticket-grid-container"); grid.innerHTML = "";
    activeLaundryTickets.forEach((ticket) => {
        const isReady = ticket.orderStatus === "Ready for Pickup";
        const totalPaid = (ticket.cashAmount||0) + (ticket.qrisAmount||0) + (ticket.hotelAmount||0) + (ticket.tamuPaidAmount||0) + (ticket.tamuPiutangAmount||0) + (ticket.freeAmount||0);
        const remaining = ticket.grandTotal - totalPaid;

        let receiptText = ticket.readableReceipt || "";
        if (!receiptText && ticket.items) receiptText = ticket.items.map(i => `${i.qty % 1 !== 0 ? i.qty.toFixed(2) : i.qty}x ${i.name}`).join('\n');

        grid.innerHTML += `
            <div class="ticket-card ${isReady ? 'ready' : ''}">
                <div class="ticket-header"><span>${ticket.customerName}</span> <span style="color:#7f8c8d; font-size:12px;">${ticket.orderId}</span></div>
                <div style="font-size:14px; margin-bottom:10px; white-space:pre-wrap;">${receiptText}</div>
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:10px; border-top:1px dashed #ddd; padding-top:5px;"><span>Remaining Due:</span> <strong style="color:#e74c3c;">Rp ${remaining.toLocaleString('id-ID')}</strong></div>
                ${!isReady ? `<button class="ticket-btn" style="background:#f39c12;" onclick="markTicketReady('${ticket.orderId}')">Mark Ready</button>` : `<button class="ticket-btn" style="background:#2ecc71;" onclick="openSettlement('${ticket.orderId}', ${remaining})">Pick Up & Settle</button>`}
            </div>
        `;
    });
}

function markTicketReady(orderId) {
    const ticket = activeLaundryTickets.find(t => t.orderId === orderId);
    if (ticket) { ticket.orderStatus = "Ready for Pickup"; ticket.syncStatus = "Pending"; db.transaction(["orders"], "readwrite").objectStore("orders").put(ticket); renderActiveTickets(); runBackgroundSync(); }
}

function openSettlement(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    document.getElementById("settle-amount").innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    document.getElementById("settle-cash").value = remainingDue; document.getElementById("settle-qris").value = 0; document.getElementById("settlement-modal").classList.remove("hidden");
}

function confirmSettlement() {
    if (!activeSettlementTicket) return;
    const c = Number(document.getElementById("settle-cash").value) || 0; const q = Number(document.getElementById("settle-qris").value) || 0;
    activeSettlementTicket.cashAmount += c; activeSettlementTicket.qrisAmount += q;
    activeSettlementTicket.orderStatus = "Completed"; activeSettlementTicket.syncStatus = "Pending";
    db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
    activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
    document.getElementById("ticket-count").innerText = activeLaundryTickets.length; document.getElementById("settlement-modal").classList.add("hidden"); renderActiveTickets(); runBackgroundSync();
}

function openExpenseModal() {
    document.getElementById("expense-modal").classList.remove("hidden");
    const list = document.getElementById("expense-category-list"); list.innerHTML = "";
    db.transaction(["expense_categories"], "readonly").objectStore("expense_categories").getAll().onsuccess = (e) => { e.target.result.forEach(cat => { const opt = document.createElement("option"); opt.value = cat.name; list.appendChild(opt); }); };
}

function saveExpense() {
    const amount = Number(document.getElementById("exp-amount").value); const category = document.getElementById("exp-category").value.trim();
    if (amount <= 0 || !category) return alert("Please enter a valid amount and category.");
    db.transaction(["expense_categories"], "readwrite").objectStore("expense_categories").put({ name: category });

    const payload = { expenseId: "EXP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, category: category, description: document.getElementById("exp-desc").value || "-", amount: amount, status: "Active", syncStatus: "Pending" };
    db.transaction(["expenses"], "readwrite").objectStore("expenses").add(payload);
    document.getElementById("expense-modal").classList.add("hidden"); document.getElementById("exp-amount").value = ""; document.getElementById("exp-category").value = ""; document.getElementById("exp-desc").value = ""; alert("Expense Recorded!"); runBackgroundSync();
}

function openHistoryModal() { document.getElementById("history-modal").classList.remove("hidden"); renderHistoryList('orders'); }

function renderHistoryList(type) {
    const container = document.getElementById("history-container"); container.innerHTML = "";
    if (type === 'orders') {
        db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
            const shiftOrders = e.target.result.filter(o => o.shiftId === currentShiftId).reverse(); 
            if(shiftOrders.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">No orders logged inside the current shift.</div>`;
            shiftOrders.forEach(o => {
                let badge = o.orderStatus === "Voided" ? `<span class="status-badge status-voided">Voided</span>` : o.orderStatus === "Void Pending" ? `<span class="status-badge status-pending">Waiting for Admin</span>` : `<span class="status-badge status-paid">${o.orderStatus}</span>`; 
                let btn = (o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending") ? `<button onclick="requestVoid('orders', '${o.orderId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Void</button>` : '';
                container.innerHTML += `<div class="history-row"><div><strong>${o.customerName}</strong><br><small style="color:#7f8c8d;">${new Date(o.timestamp).toLocaleTimeString()} | Rp ${o.grandTotal.toLocaleString('id-ID')}</small></div><div style="display:flex; align-items:center; gap:10px;">${badge} ${btn}</div></div>`;
            });
        };
    } else if (type === 'expenses') {
        db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = (e) => {
            const shiftExpenses = e.target.result.filter(exp => exp.shiftId === currentShiftId).reverse();
            if(shiftExpenses.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">No expenses logged.</div>`;
            shiftExpenses.forEach(exp => {
                let badge = exp.status === "Voided" ? `<span class="status-badge status-voided">Voided</span>` : exp.status === "Void Pending" ? `<span class="status-badge status-pending">Waiting for Admin</span>` : `<span class="status-badge status-paid">Active</span>`;
                let btn = (exp.status !== "Voided" && exp.status !== "Void Pending") ? `<button onclick="requestVoid('expenses', '${exp.expenseId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Void</button>` : '';
                container.innerHTML += `<div class="history-row"><div><strong>${exp.category}</strong><br><small style="color:#7f8c8d;">${new Date(exp.timestamp).toLocaleTimeString()} | Rp ${exp.amount.toLocaleString('id-ID')}</small><br><small>${exp.description}</small></div><div style="display:flex; align-items:center; gap:10px;">${badge} ${btn}</div></div>`;
            });
        };
    } else if (type === 'shifts') {
        db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").getAll().onsuccess = (e) => {
            const shifts = e.target.result.reverse();
            if(shifts.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">No past shifts locally stored on this device yet.</div>`;
            shifts.forEach(s => {
                container.innerHTML += `<div class="history-row"><div><strong>Shift: ${s.shiftId}</strong><br><small style="color:#7f8c8d;">Cashier: ${s.cashier} | ${new Date(s.logoutTime).toLocaleString('id-ID')}</small></div><div style="text-align:right;"><strong>Rp ${s.totalOmset.toLocaleString('id-ID')}</strong><br><small style="color:#27ae60;">Net Cash: Rp ${s.netCash.toLocaleString('id-ID')}</small></div></div>`;
            });
        };
    }
}

function requestVoid(type, id) { currentVoidTarget = { type, id }; document.getElementById("admin-void-pin").value = ""; document.getElementById("admin-void-modal").classList.remove("hidden"); }

function submitRemoteVoid() {
    const type = currentVoidTarget.type; const id = currentVoidTarget.id; const storeName = type === 'orders' ? "orders" : "expenses";
    db.transaction([storeName], "readwrite").objectStore(storeName).get(id).onsuccess = (e) => {
        const item = e.target.result; if (type === 'orders') item.orderStatus = "Void Pending"; else item.status = "Void Pending";
        db.transaction([storeName], "readwrite").objectStore(storeName).put(item); renderHistoryList(type); 
    };
    db.transaction(["void_requests"], "readwrite").objectStore("void_requests").add({ id: id, type: type, status: "Void Pending", authName: "Waiting" });
    document.getElementById("admin-void-modal").classList.add("hidden"); runBackgroundSync();
}

async function confirmAdminVoid() {
    const pin = document.getElementById("admin-void-pin").value; if (!pin) return alert("Please enter a PIN.");
    const settings = await getDynamicSettings(); const masterPin = String(settings["Master_PIN"]); const isMaster = (pin === masterPin);
    
    db.transaction(["staff"], "readonly").objectStore("staff").get(pin).onsuccess = (e) => {
        const staff = e.target.result; const isAdmin = (staff && staff.role.toLowerCase() === 'admin');
        if (isMaster || isAdmin) {
            const authName = isMaster ? "Master Admin" : staff.name; const type = currentVoidTarget.type; const id = currentVoidTarget.id; const storeName = type === 'orders' ? "orders" : "expenses";
            db.transaction([storeName], "readwrite").objectStore(storeName).get(id).onsuccess = (ev) => {
                const item = ev.target.result;
                if (type === 'orders') { item.orderStatus = "Voided"; item.voidAuth = authName; if(item.items) item.items.forEach(i => i.qty = Number(i.qty)); applyVoidAftermath(item); } 
                else { item.status = "Voided"; item.voidAuth = authName; }
                item.syncStatus = "Pending"; db.transaction([storeName], "readwrite").objectStore(storeName).put(item); renderHistoryList(type);
            };
            db.transaction(["void_requests"], "readwrite").objectStore("void_requests").add({ id: id, type: type, status: "Voided", authName: authName });
            document.getElementById("admin-void-modal").classList.add("hidden"); runBackgroundSync(); alert("Transaction instantly voided by: " + authName);
        } else { alert("Invalid PIN or no Admin privileges."); }
    };
}

function processVoidApprovals(authStatuses) {
    const tx = db.transaction(["orders", "expenses"], "readwrite"); const ordStore = tx.objectStore("orders"); const expStore = tx.objectStore("expenses"); let uiNeedsRefresh = false;
    ordStore.getAll().onsuccess = (e) => {
        e.target.result.forEach(order => {
            const remote = authStatuses.orders[order.orderId];
            if (remote) {
                if (remote.status === "Voided" && order.orderStatus !== "Voided") { order.orderStatus = "Voided"; ordStore.put(order); uiNeedsRefresh = true; applyVoidAftermath(order); } 
                else if (remote.status !== "Void Pending" && remote.status !== "Voided" && order.orderStatus === "Void Pending") { order.orderStatus = remote.status; ordStore.put(order); uiNeedsRefresh = true; }
            }
        });
        if (uiNeedsRefresh && !document.getElementById("history-modal").classList.contains("hidden")) renderHistoryList('orders');
    };
    expStore.getAll().onsuccess = (e) => {
        e.target.result.forEach(exp => {
            const remote = authStatuses.expenses[exp.expenseId];
            if (remote) {
                if (remote.status === "Voided" && exp.status !== "Voided") { exp.status = "Voided"; expStore.put(exp); uiNeedsRefresh = true; } 
                else if (remote.status !== "Void Pending" && remote.status !== "Voided" && exp.status === "Void Pending") { exp.status = remote.status; expStore.put(exp); uiNeedsRefresh = true; }
            }
        });
        if (uiNeedsRefresh && !document.getElementById("history-modal").classList.contains("hidden")) renderHistoryList('expenses');
    };
}

function applyVoidAftermath(order) {
    let itemsToReturn = []; if(order.items) order.items.forEach(i => itemsToReturn.push({ name: i.name, qty: i.qty }));
    const tx = db.transaction(["menu"], "readwrite"); const menuStore = tx.objectStore("menu");
    itemsToReturn.forEach(item => {
        menuStore.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { if (cursor.value.name === item.name && cursor.value.trackStock) { const updated = cursor.value; updated.currentStock += item.qty; cursor.update(updated); } cursor.continue(); }
        };
    });
    tx.oncomplete = () => { renderProductGrid(); };
    if (navigator.onLine) fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "executeVoidAftermath", data: { orderId: order.orderId, customerPhone: order.customerPhone, amount: order.grandTotal, itemsToReturn: itemsToReturn } }) });
}

function calculateLiveDrawer(callback) {
    let liveDrawer = window.masterDrawerBalance || 0; 
    let tx = db.transaction(["orders", "cash_drops", "expenses"], "readonly");
    let ordersReq = tx.objectStore("orders").getAll(); let dropReq = tx.objectStore("cash_drops").getAll(); let expReq = tx.objectStore("expenses").getAll();
    tx.oncomplete = () => {
        ordersReq.result.forEach(o => { if (o.syncStatus === "Pending" && o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending") liveDrawer += (o.cashAmount || 0); });
        dropReq.result.forEach(d => { if (d.syncStatus === "Pending") liveDrawer -= (d.toAdmin + d.toBank); });
        expReq.result.forEach(e => { if (e.syncStatus === "Pending" && e.status === "Active") liveDrawer -= (e.amount || 0); });
        callback(liveDrawer);
    };
}

function openCashDrop(forLogout = false) {
    isLoggingOut = forLogout; document.getElementById("cash-drop-title").innerText = isLoggingOut ? "🔒 End of Shift Cash Log" : "🏦 Store / Pull Money";
    document.getElementById("btn-drop-cancel").innerText = isLoggingOut ? "Cancel Logout" : "Cancel"; document.getElementById("btn-drop-confirm").innerText = isLoggingOut ? "Confirm & Logout" : "Save Record";
    document.getElementById("drop-amount").value = ""; document.getElementById("drop-destination").value = "Admin"; document.getElementById("drop-notes").value = "";
    
    calculateLiveDrawer((liveAmount) => { document.getElementById("live-drawer-display").innerText = `Rp ${liveAmount.toLocaleString('id-ID')}`; document.getElementById("cash-drop-modal").classList.remove("hidden"); });
}

function submitCashDrop() {
    const pullAmount = Number(document.getElementById("drop-amount").value) || 0;
    if (pullAmount <= 0) return alert("⚠️ ERROR: Please enter a valid amount to pull from the drawer.");
    const destination = document.getElementById("drop-destination").value; const customNotes = document.getElementById("drop-notes").value || (isLoggingOut ? "Shift End" : "Mid-shift Drop");
    let adminAmt = 0; let bankAmt = 0; if (destination === "Bank") bankAmt = pullAmount; else adminAmt = pullAmount;
    const finalNotes = `[To ${destination}] ${customNotes}`;
    
    calculateLiveDrawer((liveAmount) => {
        const leftInDrawer = liveAmount - pullAmount;
        const payload = { dropId: "DRP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, toAdmin: adminAmt, toBank: bankAmt, leftInDrawer: leftInDrawer, notes: finalNotes, syncStatus: "Pending" };
        db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").add(payload);
        document.getElementById("cash-drop-modal").classList.add("hidden"); runBackgroundSync();
        if (isLoggingOut) { executeFinalLogout(leftInDrawer); } else { alert(`Cash Drop Logged!\nDestination: ${destination}\nLeft in Drawer: Rp ${leftInDrawer.toLocaleString('id-ID')}`); }
    });
}

function openShiftReport() {
    let tCust = 0; let tOrders = 0; let tOmset = 0; let tCash = 0; let tQris = 0; let tHotel = 0; let tp = 0; let tu = 0; let tFree = 0; let tPiutang = 0; let tExpense = 0; let foodSummary = {};
    document.getElementById("meter-token").value = ""; document.getElementById("meter-pasca").value = "";
    
    db.transaction(["orders", "expenses"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
        const validOrders = e.target.result.filter(o => o.shiftId === currentShiftId && o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending");
        validOrders.forEach(o => {
            tOrders++; if(o.customerPhone && o.customerPhone !== "-") tCust++; tOmset += o.grandTotal;
            tCash += (o.cashAmount || 0); tQris += (o.qrisAmount || 0); tHotel += (o.hotelAmount || 0); tp += (o.tamuPaidAmount || 0); tu += (o.tamuPiutangAmount || 0); tFree += (o.freeAmount || 0); tPiutang += (o.remainingDue || 0);
            if (o.items) o.items.forEach(i => { if(!foodSummary[i.name]) foodSummary[i.name] = 0; foodSummary[i.name] += i.qty; });
        });
        
        db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = (ex) => {
            const shiftExpenses = ex.target.result.filter(exp => exp.shiftId === currentShiftId && exp.status === "Active"); shiftExpenses.forEach(exp => { tExpense += (exp.amount || 0); });
            
            calculateLiveDrawer((liveDrawer) => {
                document.getElementById("sr-orders").innerText = tOrders; document.getElementById("sr-customers").innerText = tCust; document.getElementById("sr-omset").innerText = `Rp ${tOmset.toLocaleString('id-ID')}`;
                document.getElementById("sr-cash").innerText = `Rp ${tCash.toLocaleString('id-ID')}`; document.getElementById("sr-qris").innerText = `Rp ${tQris.toLocaleString('id-ID')}`; document.getElementById("sr-hotel").innerText = `Rp ${tHotel.toLocaleString('id-ID')}`;
                document.getElementById("sr-tamupaid").innerText = `Rp ${tp.toLocaleString('id-ID')}`; document.getElementById("sr-tamupiutang").innerText = `Rp ${tu.toLocaleString('id-ID')}`; document.getElementById("sr-free").innerText = `Rp ${tFree.toLocaleString('id-ID')}`; document.getElementById("sr-piutang").innerText = `Rp ${tPiutang.toLocaleString('id-ID')}`;
                if(document.getElementById("sr-expense")) document.getElementById("sr-expense").innerText = `Rp ${tExpense.toLocaleString('id-ID')}`;
                document.getElementById("sr-net").innerText = `Rp ${liveDrawer.toLocaleString('id-ID')}`; document.getElementById("shift-report-modal").classList.remove("hidden");
                
                window.currentShiftData = { totalCustomers: tCust, totalOrders: tOrders, totalOmset: tOmset, totalCash: tCash, totalQris: tQris, totalHotel: tHotel, totalTamuPaid: tp, totalTamuPiutang: tu, totalFree: tFree, totalPiutang: tPiutang, totalExpenses: tExpense, net: liveDrawer, foodSummary };
            });
        };
    };
}

function initiateLogoutSequence() { 
    const meterT = document.getElementById("meter-token").value; const meterP = document.getElementById("meter-pasca").value;
    if (meterT === "" || meterP === "") return alert("⚠️ ERROR: You must enter both Electricity Meter readings before ending your shift.");
    window.currentShiftData.meterToken = Number(meterT); window.currentShiftData.meterPasca = Number(meterP);
    document.getElementById("shift-report-modal").classList.add("hidden"); openCashDrop(true); 
}

async function executeFinalLogout(netCash) { 
    const data = window.currentShiftData;
    const shiftPayload = {
        shiftId: currentShiftId, timestamp: new Date().toISOString(), cashier: currentCashier, loginTime: currentLoginTime, logoutTime: new Date().toISOString(), 
        totalCustomers: data.totalCustomers, totalOrders: data.totalOrders, totalOmset: data.totalOmset, totalCash: data.totalCash, totalQris: data.totalQris, totalHotel: data.totalHotel, totalTamuPaid: data.totalTamuPaid, totalTamuPiutang: data.totalTamuPiutang, totalFree: data.totalFree, totalPiutang: data.totalPiutang,
        totalExpenses: data.totalExpenses, netCash: netCash, foodSummary: data.foodSummary, meterToken: data.meterToken, meterPasca: data.meterPasca, syncStatus: "Pending"
    };

    db.transaction(["local_shift_history"], "readwrite").objectStore("local_shift_history").add(shiftPayload);
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
    if (!navigator.onLine || isSyncing) return;
    isSyncing = true; 
    try {
        let tx = db.transaction(["orders", "cash_drops", "shift_reports", "expenses", "void_requests", "unsynced_members"], "readonly");
        
        let orders = await new Promise(res => tx.objectStore("orders").getAll().onsuccess = e => res(e.target.result));
        for (const order of orders) {
            if (order.syncStatus === "Pending") {
                order.syncStatus = "Syncing"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order);
                try { let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncOrder", data: order }) }); if ((await r.json()).status === "Success") { order.syncStatus = "Synced"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); } else { order.syncStatus = "Pending"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); } } catch(e) { order.syncStatus = "Pending"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); }
            }
        }
        
        let drops = await new Promise(res => tx.objectStore("cash_drops").getAll().onsuccess = e => res(e.target.result));
        for (const drop of drops) {
            if (drop.syncStatus === "Pending") { try { let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncCashDrop", data: drop }) }); if ((await r.json()).status === "Success") { drop.syncStatus = "Synced"; db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").put(drop); } } catch(e) {} }
        }
        
        let reports = await new Promise(res => tx.objectStore("shift_reports").getAll().onsuccess = e => res(e.target.result));
        for (const report of reports) {
            if (report.syncStatus === "Pending") { try { let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncShiftReport", data: report }) }); if ((await r.json()).status === "Success") { db.transaction(["shift_reports"], "readwrite").objectStore("shift_reports").delete(report.shiftId); } } catch(e) {} }
        }

        let expenses = await new Promise(res => tx.objectStore("expenses").getAll().onsuccess = e => res(e.target.result));
        for (const exp of expenses) {
            if (exp.syncStatus === "Pending") { try { let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncExpense", data: exp }) }); if ((await r.json()).status === "Success") { exp.syncStatus = "Synced"; db.transaction(["expenses"], "readwrite").objectStore("expenses").put(exp); } } catch(e) {} }
        }

        let voids = await new Promise(res => tx.objectStore("void_requests").getAll().onsuccess = e => res(e.target.result));
        for (const req of voids) {
            try {
                const actionType = req.type === 'orders' ? "requestOrderVoid" : "requestExpenseVoid"; const payload = req.type === 'orders' ? { orderId: req.id, status: req.status, authName: req.authName } : { expenseId: req.id, status: req.status, authName: req.authName };
                let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: actionType, ...payload }) }); if ((await r.json()).status === "Success") { db.transaction(["void_requests"], "readwrite").objectStore("void_requests").delete(req.id); }
            } catch(e) {}
        }

        let members = await new Promise(res => tx.objectStore("unsynced_members").getAll().onsuccess = e => res(e.target.result));
        for (const mem of members) {
            try { let r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "syncMember", data: mem }) }); if ((await r.json()).status === "Success") { db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").delete(mem.phone); } } catch(e) {}
        }
    } finally { isSyncing = false; }
}

window.onload = async () => { await initDB(); await syncMasterData(); window.setInterval(runBackgroundSync, 15000); };
