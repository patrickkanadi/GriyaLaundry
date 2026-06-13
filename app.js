const API_URL = "https://script.google.com/macros/s/AKfycbyqhUWHZIy1g-tGk8lHX51Ayf2byF6oK3-LsVo8lVpT7AReYmEi61GRhIwfBivlZfto/exec"; 
const DB_NAME = "GriyaLaundry_POS";
const DB_VERSION = 12; // Bumped for new Ticket Coin flow
let db;

let currentCashier = ""; let currentPin = ""; let currentShiftId = ""; let currentLoginTime = "";
let globalMenuData = []; let currentCategory = ""; let activeLaundryTickets = [];
let currentCart = []; let activeNumpadItem = null; let numpadValue = "0";
let activeSettlementTicket = null; window.masterDrawerBalance = 0; let isLoggingOut = false;
let currentVoidTarget = { type: null, id: null };
let isMenuLocked = true; let isSyncing = false; 
let activeCustomerProfile = null; let activeCoinPrice = 10000;

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    const installBtn = document.getElementById('btn-install');
    if(installBtn) installBtn.classList.remove('hidden');
});

function installPWA() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') document.getElementById('btn-install').classList.add('hidden');
            deferredPrompt = null;
        });
    }
}

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
            if (!db.objectStoreNames.contains("coin_retrievals")) db.createObjectStore("coin_retrievals", { keyPath: "retrievalId" });
            if (!db.objectStoreNames.contains("ticket_coins")) db.createObjectStore("ticket_coins", { keyPath: "logId" });
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
        } else { alert("PIN Salah!"); }
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
        if (phone.length < 5) return alert("Harap masukkan Nomor WhatsApp yang valid terlebih dahulu.");
    }
    isMenuLocked = false; document.getElementById("glass-overlay").style.opacity = "0"; setTimeout(() => { document.getElementById("glass-overlay").style.pointerEvents = "none"; }, 300);
}

async function manualPushSync() {
    if (!navigator.onLine) return alert("Anda sedang offline!");
    document.getElementById("network-text").innerText = "Mengirim Data..."; document.getElementById("network-dot").style.backgroundColor = "#f39c12";
    await runBackgroundSync(); document.getElementById("network-text").innerText = "Menarik Data..."; await syncMasterData(); alert("Sinkronisasi Database Berhasil!");
}

async function syncMasterData() {
    if (!navigator.onLine) {
        if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Mode Offline";
        if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#e74c3c"; return;
    }
    if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Sinkronisasi...";
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
            if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Online & Sinkron";
            if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#2ecc71";
            if (!document.getElementById("pos-screen").classList.contains("hidden")) { loadMenuUI(); renderActiveTickets(); }
        } else { throw new Error(result.message); }
    } catch (e) { 
        if(document.getElementById("network-text")) document.getElementById("network-text").innerText = "Gagal Sinkron"; 
        if(document.getElementById("network-dot")) document.getElementById("network-dot").style.backgroundColor = "#e74c3c";
    }
}

function handleAutocomplete(e) {
    const val = e.target.value.toLowerCase().trim(); const resBox = document.getElementById("autocomplete-results");
    activeCustomerProfile = null; document.getElementById("promo-indicator").classList.add("hidden");
    if (val.length < 1) { resBox.classList.add("hidden"); return; } 

    db.transaction(["members"], "readonly").objectStore("members").getAll().onsuccess = (ev) => {
        const members = ev.target.result; const matches = members.filter(m => String(m.phone).toLowerCase().includes(val) || String(m.name).toLowerCase().includes(val)).slice(0, 10);
        if (matches.length > 0) {
            resBox.innerHTML = matches.map(m => `<div class="autocomplete-item" onclick="selectMember('${m.phone}', '${m.name.replace(/'/g, "\\'")}', ${m.points}, ${m.freeCoins})"><div class="autocomplete-phone">${m.phone}</div><div class="autocomplete-name">${m.name}</div></div>`).join("");
            resBox.classList.remove("hidden");
        } else { resBox.classList.add("hidden"); }
    };
}
document.getElementById("cust-phone").addEventListener("input", handleAutocomplete);
document.getElementById("cust-name").addEventListener("input", handleAutocomplete);
document.getElementById("cust-phone").addEventListener("click", handleAutocomplete);
document.getElementById("cust-name").addEventListener("click", handleAutocomplete);
document.getElementById("cust-phone").addEventListener("focus", handleAutocomplete);
document.getElementById("cust-name").addEventListener("focus", handleAutocomplete);

document.addEventListener('click', (e) => { if(!e.target.closest('.autocomplete-wrapper') && e.target.id !== 'cust-phone' && e.target.id !== 'cust-name') document.getElementById('autocomplete-results').classList.add('hidden'); });

window.selectMember = function(phone, name, points, freeCoins) {
    document.getElementById("cust-phone").value = phone; document.getElementById("cust-name").value = name; document.getElementById("autocomplete-results").classList.add("hidden");
    activeCustomerProfile = { phone, name, points, freeCoins };
    
    let promoText = "";
    if (freeCoins > 0) promoText = `🎁 ${freeCoins} Koin Gratis Tersedia! (Sisa Poin: ${points}/10)`;
    else promoText = `🎁 Poin Koin Saat Ini: ${points}/10`;
    
    document.getElementById("promo-indicator").innerText = promoText; document.getElementById("promo-indicator").classList.remove("hidden");
};

function saveMemberToDB(phone, name) {
    if(!phone || phone === "-") return; 
    db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (e) => {
        let mem = e.target.result || { phone: phone, name: name, points: 0, freeCoins: 0 }; mem.name = name;
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
    if (existing) existing.qty += qty; else currentCart.push({ ...item, qty: qty, originalPrice: item.price, expectedCoins: item.expectedCoins });
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
    if (currentCart.length === 0) return alert("Keranjang masih kosong!");
    
    let totalCoinsInCart = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    if (activeCustomerProfile && activeCustomerProfile.freeCoins > 0 && totalCoinsInCart > 0) {
        document.getElementById("promo-section").classList.remove("hidden");
        document.getElementById("promo-text").innerText = `Anda punya ${activeCustomerProfile.freeCoins} koin gratis. Maksimal bisa diklaim sekarang: ${Math.min(activeCustomerProfile.freeCoins, totalCoinsInCart)}`;
        document.getElementById("redeem-coins").max = Math.min(activeCustomerProfile.freeCoins, totalCoinsInCart); document.getElementById("redeem-coins").value = 0;
    } else { document.getElementById("promo-section").classList.add("hidden"); document.getElementById("redeem-coins").value = 0; }

    document.getElementById("pay-cash").value = 0; document.getElementById("pay-qris").value = 0; document.getElementById("pay-transfer").value = 0;
    document.getElementById("pay-hotel-piutang").value = 0; document.getElementById("pay-tamu-piutang").value = 0; document.getElementById("pay-free").value = 0;
    
    window.cartGrandTotal = window.cartSubtotal;
    // THIS LINE CAUSED THE BUG (Missing Subtotal HTML Element) - Removed to fix crash.
    document.getElementById("review-grandtotal").innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    
    applyPromo(); document.getElementById("review-modal").classList.remove("hidden");
}

window.applyPromo = function() {
    let redeemCount = Number(document.getElementById("redeem-coins").value) || 0;
    let totalCoinsInCart = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    
    if (redeemCount > totalCoinsInCart) { redeemCount = totalCoinsInCart; }
    if (activeCustomerProfile && redeemCount > activeCustomerProfile.freeCoins) { redeemCount = activeCustomerProfile.freeCoins; }
    document.getElementById("redeem-coins").value = redeemCount;

    let freeValue = redeemCount * activeCoinPrice;
    document.getElementById("pay-free").value = freeValue; 

    let q = Number(document.getElementById("pay-qris").value) || 0; let t = Number(document.getElementById("pay-transfer").value) || 0;
    let hp = Number(document.getElementById("pay-hotel-piutang").value) || 0; let tp = Number(document.getElementById("pay-tamu-piutang").value) || 0;
    
    let autoCash = window.cartGrandTotal - (q + t + hp + tp + freeValue);
    document.getElementById("pay-cash").value = Math.max(0, autoCash); calculateRemaining();
}

window.calculateRemaining = function() {
    const c = Number(document.getElementById("pay-cash").value) || 0; const q = Number(document.getElementById("pay-qris").value) || 0;
    const t = Number(document.getElementById("pay-transfer").value) || 0; const hp = Number(document.getElementById("pay-hotel-piutang").value) || 0;
    const tp = Number(document.getElementById("pay-tamu-piutang").value) || 0; const f = Number(document.getElementById("pay-free").value) || 0;
    
    const totalAccounted = c + q + t + hp + tp + f; const remaining = Math.max(0, window.cartGrandTotal - totalAccounted);
    document.getElementById("review-remaining").innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
}

function closeReview() { document.getElementById("review-modal").classList.add("hidden"); }

async function finalizeOrder(shouldPrint) {
    const cash = Number(document.getElementById("pay-cash").value) || 0; const qris = Number(document.getElementById("pay-qris").value) || 0;
    const transfer = Number(document.getElementById("pay-transfer").value) || 0; const hotelPiutang = Number(document.getElementById("pay-hotel-piutang").value) || 0;
    const tamuPiutang = Number(document.getElementById("pay-tamu-piutang").value) || 0; const free = Number(document.getElementById("pay-free").value) || 0;
    const redeemCount = Number(document.getElementById("redeem-coins").value) || 0;
    
    const totalPiutang = hotelPiutang + tamuPiutang;
    const totalAccounted = cash + qris + transfer + free + totalPiutang; 
    const remaining = window.cartGrandTotal - totalAccounted;

    const requiresProcessing = currentCart.some(i => String(i.workflow).toUpperCase() === "TICKET");
    const custPhone = document.getElementById("cust-phone").value.trim(); const custName = document.getElementById("cust-name").value.trim() || "Walk-in";
    const hasHotelItem = currentCart.some(i => String(i.category).toLowerCase().includes("hotel"));

    if (remaining > 0) return alert("⚠️ PEMBAYARAN DITOLAK:\nSisa Kurang Bayar harus Rp 0. Jika ada hutang, wajib dicatat di kolom Piutang B2B/Tamu.");
    if (totalPiutang > 0 && !requiresProcessing) return alert("⚠️ PEMBAYARAN DITOLAK:\nPiutang HANYA berlaku untuk Tiket Drop-off.");
    if (totalPiutang > 0 && !hasHotelItem) return alert("⚠️ PEMBAYARAN DITOLAK:\nPiutang HANYA berlaku untuk item dalam kategori Hotel.");
    if (totalPiutang > 0 && (!custPhone || custPhone === "-")) return alert("⚠️ PEMBAYARAN DITOLAK:\nAnda WAJIB memasukkan nomor WhatsApp pelanggan untuk mencatat Piutang.");

    let payMethods = [];
    if(cash > 0) payMethods.push("Tunai"); if(qris > 0) payMethods.push("QRIS"); if(transfer > 0) payMethods.push("Trf.Bank"); if(hotelPiutang > 0) payMethods.push("Piutang(B2B)"); if(tamuPiutang > 0) payMethods.push("Piutang(Tamu)"); if(free > 0) payMethods.push("Gratis");
    const payString = payMethods.length > 0 ? payMethods.join("+") : "Belum Bayar";

    if(custPhone) saveMemberToDB(custPhone, custName);

    let status = "Completed"; if (totalPiutang > 0) status = "Pending Debt"; else if (requiresProcessing) status = "Processing";

    let totalCoinsInCart = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    let coinsEarned = Math.max(0, totalCoinsInCart - redeemCount);

    let newPoints = 0; let newFree = 0;
    if (activeCustomerProfile) {
        let currentPoints = activeCustomerProfile.points || 0; let currentFree = activeCustomerProfile.freeCoins || 0;
        currentFree -= redeemCount; currentPoints += coinsEarned;
        let newlyEarnedFree = Math.floor(currentPoints / 10); currentPoints = currentPoints % 10; currentFree += newlyEarnedFree;
        newPoints = currentPoints; newFree = currentFree;
        
        db.transaction(["members"], "readwrite").objectStore("members").get(activeCustomerProfile.phone).onsuccess = (e) => {
            let mem = e.target.result; if (mem) { mem.points = newPoints; mem.freeCoins = newFree; db.transaction(["members"], "readwrite").objectStore("members").put(mem); }
        };
    }

    // Hitung Estimasi Koin (Hanya untuk Ticket)
    let expectedCoinsTotal = currentCart.reduce((sum, item) => sum + ((item.expectedCoins || 0) * item.qty), 0);

    const orderPayload = {
        orderId: "ORD-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId,
        customerName: custName, customerPhone: custPhone || "-", orderStatus: status, items: currentCart, subtotal: window.cartSubtotal, discounts: (redeemCount * activeCoinPrice), grandTotal: window.cartGrandTotal,
        paymentMethod: payString, cashAmount: cash, qrisAmount: qris, transferAmount: transfer, hotelPiutangAmount: hotelPiutang, tamuPiutangAmount: tamuPiutang, freeAmount: free, remainingDue: 0,
        coinsEarned: coinsEarned, coinsRedeemed: redeemCount, expectedCoins: expectedCoinsTotal, syncStatus: "Pending" 
    };

    const txMenu = db.transaction(["menu"], "readwrite"); const storeMenu = txMenu.objectStore("menu");
    currentCart.forEach(cartItem => {
        storeMenu.get(cartItem.itemId).onsuccess = (ev) => {
            const menuItem = ev.target.result;
            if (menuItem && menuItem.trackStock) { menuItem.currentStock = Math.max(0, menuItem.currentStock - cartItem.qty); storeMenu.put(menuItem); }
        };
    });

    db.transaction(["orders"], "readwrite").objectStore("orders").add(orderPayload);
    if (requiresProcessing) { activeLaundryTickets.unshift(orderPayload); document.getElementById("ticket-count").innerText = activeLaundryTickets.length; }
    
    if (shouldPrint) { await buildPrintableReceipt(orderPayload.orderId, orderPayload, (cash + qris + transfer + free + totalPiutang), 0, payString, newPoints, newFree); window.print(); }
    closeReview(); lockMenu(); renderProductGrid(); runBackgroundSync();
}

async function getDynamicSettings() { return new Promise(res => { let req = db.transaction(["settings"], "readonly").objectStore("settings").getAll(); req.onsuccess = e => { let s = {}; e.target.result.forEach(row => s[row.key] = row.value); res(s); }; }); }

async function buildPrintableReceipt(orderId, order, deposit, remaining, payMethod, newPoints, newFree) {
    const settings = await getDynamicSettings();
    const h1 = settings["Header_1"] || "GRIYA LAUNDRY"; const h2 = settings["Header_2"] || ""; const h3 = settings["Header_3"] || ""; 
    const f1 = settings["Footer_1"] || "TERIMA KASIH"; const f2 = settings["Footer_2"] || ""; const f3 = settings["Footer_3"] || ""; 
    const printArea = document.getElementById("printable-area"); const dateStr = new Date().toLocaleString('id-ID');
    
    let itemsHtml = "";
    order.items.forEach(item => {
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty; const lineTotal = item.qty * item.originalPrice;
        itemsHtml += `<div style="display:flex; justify-content:space-between; margin-bottom: 2px;"><span>${qtyDisplay}x ${item.name}</span><span>${lineTotal.toLocaleString('id-ID')}</span></div>`;
    });
    
    let poinHtml = "";
    if (order.customerPhone && order.customerPhone !== "-") {
        poinHtml = `<div style="margin-top:10px; padding-top:5px; border-top:1px dashed #000; font-size:11px; text-align:center;"><strong>-- INFO POIN LAUNDRY --</strong><br>Sisa Poin: ${newPoints}/10<br>Koin Gratis Tersedia: ${newFree}</div>`;
    }

    printArea.innerHTML = `
        <div style="text-align:center; margin-bottom:10px;"><h2 style="margin:0;">${h1}</h2>${h2 ? `<div style="font-size:10px;">${h2}</div>` : ''}${h3 ? `<div style="font-size:10px;">${h3}</div>` : ''}<div style="font-size:10px; margin-top:5px;">${dateStr}</div></div>
        <div style="border-top:1px dashed #000; border-bottom:1px dashed #000; padding:5px 0; margin-bottom:5px; font-size: 11px;"><div>Nota: ${orderId}</div><div>Pelanggan: ${order.customerName}</div><div>Kasir: ${currentCashier}</div></div>
        ${itemsHtml}
        <div style="border-top:1px dashed #000; margin-top:10px; padding-top:5px;">
            <div style="display:flex; justify-content:space-between; font-size:11px;"><span>Subtotal:</span><span>Rp ${order.subtotal.toLocaleString('id-ID')}</span></div>
            <div style="display:flex; justify-content:space-between; font-weight:bold; font-size:14px; margin-top:5px; border-bottom: 1px solid #000; padding-bottom: 5px;"><span>TOTAL:</span><span>Rp ${order.grandTotal.toLocaleString('id-ID')}</span></div>
        </div>
        <div style="margin-top:5px; font-size:11px;">
            <div style="display:flex; justify-content:space-between;"><span>Tercatat (${payMethod}):</span><span>Rp ${deposit.toLocaleString('id-ID')}</span></div>
            ${order.hotelPiutangAmount > 0 || order.tamuPiutangAmount > 0 ? `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-top: 5px;"><span>TOTAL PIUTANG:</span><span>Rp ${(order.hotelPiutangAmount + order.tamuPiutangAmount).toLocaleString('id-ID')}</span></div>` : `<div style="display:flex; justify-content:space-between; font-weight:bold; margin-top: 5px;"><span>STATUS:</span><span>LUNAS</span></div>`}
        </div>
        ${poinHtml}
        <div style="text-align:center; margin-top:15px; font-weight:bold; font-size: 12px;">${f1}</div>${f2 ? `<div style="text-align:center; margin-top:2px; font-size: 10px;">${f2}</div>` : ''}${f3 ? `<div style="text-align:center; margin-top:2px; font-size: 10px;">${f3}</div>` : ''}
    `;
}

function renderActiveTickets() {
    const grid = document.getElementById("ticket-grid-container"); grid.innerHTML = "";
    activeLaundryTickets.forEach((ticket) => {
        const isReady = ticket.orderStatus === "Ready for Pickup";
        const totalPaid = (ticket.cashAmount||0) + (ticket.qrisAmount||0) + (ticket.transferAmount||0) + (ticket.freeAmount||0);
        const remaining = ticket.grandTotal - totalPaid;

        let receiptText = ticket.readableReceipt || "";
        if (!receiptText && ticket.items) receiptText = ticket.items.map(i => `${i.qty % 1 !== 0 ? i.qty.toFixed(2) : i.qty}x ${i.name}`).join('\n');

        grid.innerHTML += `
            <div class="ticket-card ${isReady ? 'ready' : ''}">
                <div class="ticket-header"><span>${ticket.customerName}</span> <span style="color:#7f8c8d; font-size:12px;">${ticket.orderId}</span></div>
                <div style="font-size:14px; margin-bottom:10px; white-space:pre-wrap;">${receiptText}</div>
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:10px; border-top:1px dashed #ddd; padding-top:5px;"><span>Piutang / Sisa:</span> <strong style="color:#e74c3c;">Rp ${remaining.toLocaleString('id-ID')}</strong></div>
                ${!isReady ? `<button class="ticket-btn" style="background:#f39c12;" onclick="markTicketReady('${ticket.orderId}', ${ticket.expectedCoins || 0})">Tandai Selesai Cuci</button>` : `<button class="ticket-btn" style="background:#2ecc71;" onclick="openSettlement('${ticket.orderId}', ${remaining})">Ambil Cucian & Bayar</button>`}
            </div>
        `;
    });
}

// ----------------------------------------------------
// NEW TICKET DONE / COIN USAGE AUDIT ENGINE
// ----------------------------------------------------
let activeDoneOrderId = null;
window.markTicketReady = function(orderId, expectedCoins) {
    activeDoneOrderId = orderId;
    document.getElementById("done-expected-coins").innerText = expectedCoins;
    document.getElementById("done-actual-coins").value = expectedCoins;
    document.getElementById("ticket-done-modal").classList.remove("hidden");
}

window.submitTicketDone = function() {
    let actual = Number(document.getElementById("done-actual-coins").value) || 0;
    let expected = Number(document.getElementById("done-expected-coins").innerText) || 0;

    if (actual < 0) return alert("Jumlah koin tidak valid.");

    const ticket = activeLaundryTickets.find(t => t.orderId === activeDoneOrderId);
    if (ticket) {
        ticket.orderStatus = "Ready for Pickup";
        ticket.syncStatus = "Pending";
        db.transaction(["orders"], "readwrite").objectStore("orders").put(ticket);

        if (actual > 0) {
            let overuse = Math.max(0, actual - expected);
            let baseUsage = Math.min(expected, actual);

            const payload = {
                retrievalId: "TKC-" + Date.now(), // Use same table as coin retrieval
                orderId: activeDoneOrderId,
                timestamp: new Date().toISOString(),
                cashier: currentCashier,
                expected: baseUsage,
                overuse: overuse,
                syncStatus: "Pending"
            };
            db.transaction(["ticket_coins"], "readwrite").objectStore("ticket_coins").add(payload);
        }

        renderActiveTickets(); runBackgroundSync();
    }
    document.getElementById("ticket-done-modal").classList.add("hidden");
}

function openSettlement(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    document.getElementById("settle-amount").innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    document.getElementById("settle-cash").value = remainingDue; document.getElementById("settle-qris").value = 0; document.getElementById("settle-transfer").value = 0; document.getElementById("settlement-modal").classList.remove("hidden");
}

function confirmSettlement() {
    if (!activeSettlementTicket) return;
    const c = Number(document.getElementById("settle-cash").value) || 0; const q = Number(document.getElementById("settle-qris").value) || 0; const t = Number(document.getElementById("settle-transfer").value) || 0;
    activeSettlementTicket.cashAmount += c; activeSettlementTicket.qrisAmount += q; activeSettlementTicket.transferAmount += t;
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
    if (amount <= 0 || !category) return alert("Harap masukkan jumlah dan kategori yang benar.");
    db.transaction(["expense_categories"], "readwrite").objectStore("expense_categories").put({ name: category });

    const payload = { expenseId: "EXP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, category: category, description: document.getElementById("exp-desc").value || "-", amount: amount, status: "Active", syncStatus: "Pending" };
    db.transaction(["expenses"], "readwrite").objectStore("expenses").add(payload);
    document.getElementById("expense-modal").classList.add("hidden"); document.getElementById("exp-amount").value = ""; document.getElementById("exp-category").value = ""; document.getElementById("exp-desc").value = ""; alert("Pengeluaran Berhasil Dicatat!"); runBackgroundSync();
}

function openHistoryModal() { document.getElementById("history-modal").classList.remove("hidden"); renderHistoryList('orders'); }

function renderHistoryList(type) {
    const container = document.getElementById("history-container"); container.innerHTML = "";
    if (type === 'orders') {
        db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
            const shiftOrders = e.target.result.filter(o => o.shiftId === currentShiftId).reverse(); 
            if(shiftOrders.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada order di shift ini.</div>`;
            shiftOrders.forEach(o => {
                let badge = o.orderStatus === "Voided" ? `<span class="status-badge status-voided">Dibatalkan</span>` : o.orderStatus === "Void Pending" ? `<span class="status-badge status-pending">Menunggu Admin</span>` : `<span class="status-badge status-paid">${o.orderStatus}</span>`; 
                let btn = (o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending") ? `<button onclick="requestVoid('orders', '${o.orderId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Batal/Void</button>` : '';
                container.innerHTML += `<div class="history-row"><div><strong>${o.customerName}</strong><br><small style="color:#7f8c8d;">${new Date(o.timestamp).toLocaleTimeString()} | Rp ${o.grandTotal.toLocaleString('id-ID')}</small></div><div style="display:flex; align-items:center; gap:10px;">${badge} ${btn}</div></div>`;
            });
        };
    } else if (type === 'expenses') {
        db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = (e) => {
            const shiftExpenses = e.target.result.filter(exp => exp.shiftId === currentShiftId).reverse();
            if(shiftExpenses.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada pengeluaran dicatat.</div>`;
            shiftExpenses.forEach(exp => {
                let badge = exp.status === "Voided" ? `<span class="status-badge status-voided">Dibatalkan</span>` : exp.status === "Void Pending" ? `<span class="status-badge status-pending">Menunggu Admin</span>` : `<span class="status-badge status-paid">Aktif</span>`;
                let btn = (exp.status !== "Voided" && exp.status !== "Void Pending") ? `<button onclick="requestVoid('expenses', '${exp.expenseId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Batal/Void</button>` : '';
                container.innerHTML += `<div class="history-row"><div><strong>${exp.category}</strong><br><small style="color:#7f8c8d;">${new Date(exp.timestamp).toLocaleTimeString()} | Rp ${exp.amount.toLocaleString('id-ID')}</small><br><small>${exp.description}</small></div><div style="display:flex; align-items:center; gap:10px;">${badge} ${btn}</div></div>`;
            });
        };
    } else if (type === 'shifts') {
        db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").getAll().onsuccess = (e) => {
            const shifts = e.target.result.reverse();
            if(shifts.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada histori shift di tablet ini.</div>`;
            shifts.forEach(s => {
                container.innerHTML += `<div class="history-row"><div><strong>Shift: ${s.shiftId}</strong><br><small style="color:#7f8c8d;">Kasir: ${s.cashier} | Keluar: ${new Date(s.logoutTime).toLocaleString('id-ID')}</small></div><div style="text-align:right;"><strong>Omset: Rp ${s.totalOmset.toLocaleString('id-ID')}</strong><br><small style="color:#27ae60;">Uang Tunai Laci: Rp ${s.netCash.toLocaleString('id-ID')}</small></div></div>`;
            });
        };
    }
}

document.getElementById("coin-action-type").addEventListener("change", function() {
    const noteCont = document.getElementById("coin-note-container");
    if(this.value === "jammed") noteCont.style.display = "block"; else noteCont.style.display = "none";
});

function openCoinManagement() {
    document.getElementById("manage-coin-qty").value = "";
    document.getElementById("manage-coin-note").value = "";
    document.getElementById("coin-management-modal").classList.remove("hidden");
}

function submitCoinManagement() {
    const qty = Number(document.getElementById("manage-coin-qty").value);
    const actionType = document.getElementById("coin-action-type").value;
    const note = document.getElementById("manage-coin-note").value || "Tidak ada catatan";
    
    if (qty <= 0) return alert("Harap masukkan jumlah koin yang benar.");
    if (actionType === "jammed" && document.getElementById("manage-coin-note").value.trim() === "") return alert("Untuk koin macet, Keterangan Mesin WAJIB diisi!");

    if (actionType === "recycle") {
        const payload = { retrievalId: "COIN-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, qty: qty, syncStatus: "Pending" };
        db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload);
        alert(`Request isi ulang ${qty} Koin telah dikirim ke Admin untuk di-Approve!`);
    } else if (actionType === "jammed") {
        const payload = { logId: "JAM-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, qty: qty, notes: note, syncStatus: "Pending" };
        const txMenu = db.transaction(["menu"], "readwrite");
        txMenu.objectStore("menu").openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if(cursor) { if(String(cursor.value.name).toLowerCase() === "koin_fisik") { const updated = cursor.value; updated.currentStock = Math.max(0, updated.currentStock - qty); cursor.update(updated); } cursor.continue(); }
        };
        db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload);
        alert(`${qty} Koin Macet/Rusak berhasil dicatat dan stok fisik telah dipotong.`);
    }

    document.getElementById("coin-management-modal").classList.add("hidden"); runBackgroundSync(); 
}

function requestVoid(type, id) { currentVoidTarget = { type, id }; document.getElementById("admin-void-pin").value = ""; document.getElementById("admin-void-modal").classList.remove("hidden"); }

function submitRemoteVoid() {
    const type = currentVoidTarget.type; const id = currentVoidTarget.id; const storeName = type === 'orders' ? "orders" : "expenses";
    db.transaction([storeName], "readwrite").objectStore(storeName).get(id).onsuccess = (e) => {
        const item = e.target.result; if (type === 'orders') item.orderStatus = "Void Pending"; else item.status = "Void Pending";
        db.transaction([storeName], "readwrite").objectStore(storeName).put(item); renderHistoryList(type); 
    };
    db.transaction(["void_requests"], "readwrite").objectStore("void_requests").add({ id: id, type: type, status: "Void Pending", authName: "Menunggu" });
    document.getElementById("admin-void-modal").classList.add("hidden"); runBackgroundSync(); alert("Request Pembatalan dikirim ke Admin.");
}

async function confirmAdminVoid() {
    const pin = document.getElementById("admin-void-pin").value; if (!pin) return alert("Harap masukkan PIN Admin.");
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
            document.getElementById("admin-void-modal").classList.add("hidden"); runBackgroundSync(); alert("Transaksi langsung Dibatalkan oleh: " + authName);
        } else { alert("PIN Salah atau Anda tidak memiliki akses Admin."); }
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
    const tx = db.transaction(["menu", "members"], "readwrite"); const menuStore = tx.objectStore("menu"); const memberStore = tx.objectStore("members");

    itemsToReturn.forEach(item => {
        let isCoin = String(item.name).toLowerCase().includes("koin");
        menuStore.openCursor().onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) { 
                if (isCoin && String(cursor.value.name).toLowerCase() === "koin_fisik") {
                    const updated = cursor.value; updated.currentStock += item.qty; cursor.update(updated);
                } else if (cursor.value.name === item.name && cursor.value.trackStock) { 
                    const updated = cursor.value; updated.currentStock += item.qty; cursor.update(updated); 
                } 
                cursor.continue(); 
            }
        };
    });

    if (order.customerPhone && order.customerPhone !== "Walk-in" && order.customerPhone !== "-") {
        memberStore.get(order.customerPhone).onsuccess = (e) => { 
            const mem = e.target.result; 
            if (mem) { 
                mem.spent = Math.max(0, (mem.spent || 0) - order.grandTotal); 
                let kBal = mem.points || 0; let fAvail = mem.freeCoins || 0;
                kBal -= (order.coinsEarned || 0); fAvail += (order.coinsRedeemed || 0);
                while (kBal < 0) { kBal += 10; fAvail -= 1; }
                mem.points = kBal; mem.freeCoins = Math.max(0, fAvail);
                memberStore.put(mem); 
            } 
        };
    }
    tx.oncomplete = () => { renderProductGrid(); };
    if (navigator.onLine) fetch(API_URL, { method: "POST", body: JSON.stringify({ action: "executeVoidAftermath", data: { orderId: order.orderId, customerPhone: order.customerPhone, amount: order.grandTotal, itemsToReturn: itemsToReturn, coinsEarned: order.coinsEarned, coinsRedeemed: order.coinsRedeemed } }) });
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
    isLoggingOut = forLogout; document.getElementById("cash-drop-title").innerText = isLoggingOut ? "🔒 Tutup Shift & Setor Laci" : "🏦 Simpan / Tarik Uang Laci";
    document.getElementById("btn-drop-cancel").innerText = isLoggingOut ? "Batal Logout" : "Batal"; document.getElementById("btn-drop-confirm").innerText = isLoggingOut ? "Konfirmasi & Logout" : "Simpan Data";
    document.getElementById("drop-amount").value = ""; document.getElementById("drop-destination").value = "Admin"; document.getElementById("drop-notes").value = "";
    
    calculateLiveDrawer((liveAmount) => { document.getElementById("live-drawer-display").innerText = `Rp ${liveAmount.toLocaleString('id-ID')}`; document.getElementById("cash-drop-modal").classList.remove("hidden"); });
}

function submitCashDrop() {
    const pullAmount = Number(document.getElementById("drop-amount").value) || 0;
    if (pullAmount <= 0) return alert("⚠️ ERROR: Harap masukkan nominal uang yang diambil dari laci.");
    const destination = document.getElementById("drop-destination").value; const customNotes = document.getElementById("drop-notes").value || (isLoggingOut ? "Tutup Shift" : "Tarik Uang Tengah Shift");
    let adminAmt = 0; let bankAmt = 0; if (destination === "Bank") bankAmt = pullAmount; else adminAmt = pullAmount;
    const finalNotes = `[Ke ${destination}] ${customNotes}`;
    
    calculateLiveDrawer((liveAmount) => {
        const leftInDrawer = liveAmount - pullAmount;
        const payload = { dropId: "DRP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, to
