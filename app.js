const API_URL = "https://script.google.com/macros/s/AKfycbxLfrUoCplYPUKJTbj_EUtXT2NDcU067bS8qHnapbC9g9Wr6CubXGrPJAtFKW2ti9Ts/exec";
const DB_NAME = "GriyaLaundry_POS"; const DB_VERSION = 35; let db; 
let antreans = [ { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null }, { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null }, { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null } ]; 
let currentAntreanIndex = 0;
let currentCashier = ""; let currentPin = ""; let currentShiftId = ""; let currentLoginTime = ""; 
let globalMenuDataRaw = []; window.globalMenuData = []; let currentCategory = ""; let activeLaundryTickets = []; let currentCart = []; let activeNumpadItem = null;
let numpadValue = "0"; let activeSettlementTicket = null; window.masterDrawerBalance = 0; let isLoggingOut = false; let currentVoidTarget = { type: null, id: null }; let isMenuLocked = true; let isSyncing = false; let activeCustomerProfile = null; let activeCoinPrice = 10000; window.loyaltyTarget = 10; window.globalPromos = []; window.enableDrawerTracking = true;
let btDevice = null; let btCharacteristic = null;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            db = e.target.result;
            if (!db.objectStoreNames.contains("orders")) db.createObjectStore("orders", { keyPath: "orderId" });
            if (!db.objectStoreNames.contains("expenses")) db.createObjectStore("expenses", { keyPath: "expenseId" });
            if (!db.objectStoreNames.contains("cash_drops")) db.createObjectStore("cash_drops", { keyPath: "dropId" });
            if (!db.objectStoreNames.contains("members")) db.createObjectStore("members", { keyPath: "phone" });
            if (!db.objectStoreNames.contains("unsynced_members")) db.createObjectStore("unsynced_members", { keyPath: "phone" });
            if (!db.objectStoreNames.contains("shift_reports")) db.createObjectStore("shift_reports", { keyPath: "shiftId" });
            if (!db.objectStoreNames.contains("active_shifts")) db.createObjectStore("active_shifts", { keyPath: "pin" });
            if (!db.objectStoreNames.contains("void_requests")) db.createObjectStore("void_requests", { keyPath: "id" });
            if (!db.objectStoreNames.contains("local_shift_history")) db.createObjectStore("local_shift_history", { keyPath: "shiftId" });
            if (!db.objectStoreNames.contains("promo_claims")) db.createObjectStore("promo_claims", { keyPath: "claimId" });
            if (!db.objectStoreNames.contains("coin_retrievals")) db.createObjectStore("coin_retrievals", { keyPath: "retrievalId" });
            if (!db.objectStoreNames.contains("phone_updates")) db.createObjectStore("phone_updates", { keyPath: "id" });
            if (!db.objectStoreNames.contains("staff")) db.createObjectStore("staff", { keyPath: "pin" });
            if (!db.objectStoreNames.contains("menu")) db.createObjectStore("menu", { keyPath: "itemId" });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror = (e) => reject(e);
    });
}

async function hashString(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

window.getDynamicSettings = async function() {
    if (!navigator.onLine) {
        return { "Kilo_Per_Koin_Cuci": 5, "Kilo_Per_Koin_Kering": 5, "Keset_Per_Batch": 5, "Sarung_Bantal_Per_Batch": 10 };
    }
    try {
        let response = await fetch(API_URL + "?action=init", { method: 'GET', mode: 'cors' });
        let result = await response.json();
        if (result.status === "Success" && result.data && result.data.settings) return result.data.settings;
    } catch(e) {}
    return { "Kilo_Per_Koin_Cuci": 5, "Kilo_Per_Koin_Kering": 5, "Keset_Per_Batch": 5, "Sarung_Bantal_Per_Batch": 10 };
};

window.syncInitData = async function() {
    if (!navigator.onLine) return;
    try {
        const response = await fetch(API_URL + "?action=init", { method: 'GET', mode: 'cors' });
        const result = await response.json();
        if (result.status === "Success") {
            window.availableOutlets = (result.data.settings["Available_Outlets"] || "Pusat").split(",").map(s => s.trim());
            let outletSel = document.getElementById("outlet-select");
            if (outletSel) {
                let savedOutlet = localStorage.getItem("selectedOutlet");
                outletSel.innerHTML = "";
                window.availableOutlets.forEach(out => {
                    let opt = document.createElement("option"); opt.value = out; opt.innerText = out;
                    if (out === savedOutlet) opt.selected = true;
                    outletSel.appendChild(opt);
                });
                outletSel.onchange = (e) => localStorage.setItem("selectedOutlet", e.target.value);
            }
            if (result.data.staff) {
                let txStaff = db.transaction(["staff"], "readwrite");
                result.data.staff.forEach(s => txStaff.objectStore("staff").put(s));
            }
            let loginBtn = document.getElementById("btn-login"); 
            if(loginBtn && loginBtn.innerText === "Menyiapkan...") loginBtn.innerText = "Masuk / Buka Shift";
        }
    } catch(e) {}
};

window.syncMasterData = async function(isSilent = false) {
    let nTxt = document.getElementById("network-text"); let nDot = document.getElementById("network-dot");
    if (!navigator.onLine) { 
        if(nTxt) nTxt.innerText = "Mode Offline"; if(nDot) nDot.style.backgroundColor = "#e74c3c"; return;
    }
    try {
        const response = await fetch(API_URL, { method: 'GET', mode: 'cors' });
        const result = await response.json();
        if (result.status === "Success") {
            if(nTxt) nTxt.innerText = "Online"; if(nDot) nDot.style.backgroundColor = "#2ecc71";
            window.masterDrawerBalance = result.masterDrawerBalance || 0;
            window.loyaltyTarget = result.data.loyaltyTarget || 10; 
            window.globalPromos = result.data.promos || [];
            window.globalRecentShifts = result.recentShifts || [];
            window.expenseCategories = result.data.expenseCategories || [];
            
            window.enableDrawerTracking = String(result.data.settings["Enable_Drawer_Tracking"]).toUpperCase() !== "FALSE";
            document.querySelectorAll("button[onclick*='openCashDrop'], #btn-drawer, #btn-cashdrop").forEach(btn => { if(btn) btn.style.display = window.enableDrawerTracking ? "" : "none"; });

            window.availableOutlets = (result.data.settings["Available_Outlets"] || "Pusat").split(",").map(s => s.trim());
            window.laciStocks = result.laciStock || {}; window.coinsInMachines = result.coinsInMachine || {};
            
            let outletSel = document.getElementById("outlet-select");
            if (outletSel) {
                let savedOutlet = localStorage.getItem("selectedOutlet");
                outletSel.innerHTML = "";
                window.availableOutlets.forEach(out => {
                    let opt = document.createElement("option"); opt.value = out; opt.innerText = out;
                    if (out === savedOutlet) opt.selected = true; outletSel.appendChild(opt);
                });
                outletSel.onchange = (e) => localStorage.setItem("selectedOutlet", e.target.value);
            }

            if (result.data.staff) { let txStaff = db.transaction(["staff"], "readwrite"); result.data.staff.forEach(s => txStaff.objectStore("staff").put(s)); }
            if (result.data.menu) {
                window.globalMenuDataRaw = result.data.menu;
                let txMenu = db.transaction(["menu"], "readwrite"); result.data.menu.forEach(m => txMenu.objectStore("menu").put(m));
            }
            if (result.data.members) { let txMem = db.transaction(["members"], "readwrite"); result.data.members.forEach(m => txMem.objectStore("members").put(m)); }

            let txOthers = db.transaction(["unsynced_members"], "readonly");
            txOthers.objectStore("unsynced_members").getAll().onsuccess = (e) => {
                let unsynced = e.target.result;
                if (unsynced.length > 0) { let txPut = db.transaction(["members"], "readwrite"); unsynced.forEach(m => txPut.objectStore("members").put(m)); }
                
                activeLaundryTickets = result.data.activeLaundryOrders || [];
                let tCount = activeLaundryTickets.filter(t => t.orderStatus === "Processing" || t.orderStatus === "Ready for Pickup").length;
                let pCount = activeLaundryTickets.filter(t => t.hotelPiutangAmount > 0 || t.tamuPiutangAmount > 0).length;
                
                let tc = document.getElementById("ticket-count"); if(tc) tc.innerText = tCount;
                let pc = document.getElementById("piutang-count"); if(pc) pc.innerText = pCount;
                
                if (!document.getElementById("pos-screen").classList.contains("hidden")) { window.renderActiveTickets(); window.renderPiutangTickets(); }
                if (result.data.authStatuses) processVoidApprovals(result.data.authStatuses);
            };
        }
    } catch (error) {}
};

function processVoidApprovals(authStatuses) {
    let tx = db.transaction(["orders", "expenses", "void_requests"], "readwrite");
    tx.objectStore("orders").getAll().onsuccess = (e) => {
        let orders = e.target.result;
        orders.forEach(o => {
            if (authStatuses.orders[o.orderId]) {
                let st = authStatuses.orders[o.orderId];
                if (o.orderStatus !== st.status) { o.orderStatus = st.status; o.voidAuth = st.auth; tx.objectStore("orders").put(o); }
            }
        });
    };
    tx.objectStore("expenses").getAll().onsuccess = (e) => {
        let exps = e.target.result;
        exps.forEach(ex => {
            if (authStatuses.expenses[ex.expenseId]) {
                let st = authStatuses.expenses[ex.expenseId];
                if (ex.status !== st.status) { ex.status = st.status; ex.authName = st.auth; tx.objectStore("expenses").put(ex); }
            }
        });
    };
}

function loadMenuUI() {
    const catContainer = document.getElementById("category-tabs");
    const grid = document.getElementById("product-grid");
    if (!catContainer || !grid) return;
    catContainer.innerHTML = ""; grid.innerHTML = "";
    
    let categories = [...new Set(window.globalMenuData.map(m => m.category))];
    if (categories.length === 0) { grid.innerHTML = "<p style='padding:20px;'>Menu belum tersedia untuk outlet ini.</p>"; return; }
    
    categories.forEach((cat, index) => {
        let btn = document.createElement("button"); btn.className = "cat-btn" + (index === 0 ? " active" : "");
        btn.innerText = cat; btn.onclick = () => { document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); currentCategory = cat; renderProductGrid(); };
        catContainer.appendChild(btn);
    });
    currentCategory = categories[0]; renderProductGrid();
}

function renderProductGrid() {
    const grid = document.getElementById("product-grid"); if (!grid) return;
    grid.innerHTML = "";
    let filtered = window.globalMenuData.filter(m => m.category === currentCategory);
    filtered.forEach(item => {
        let btn = document.createElement("div"); btn.className = "product-card" + (isMenuLocked ? " locked" : "");
        
        let stockDisplay = item.trackStock ? `<div style="font-size:11px; color:#e67e22; margin-top:5px;">Stok: ${item.currentStock}</div>` : "";
        let priceStr = item.price > 0 ? `<div class="price-badge">Rp ${item.price.toLocaleString('id-ID')}</div>` : `<div class="price-badge" style="background:#27ae60;">Gratis</div>`;
        
        btn.innerHTML = `<h4>${item.name}</h4><p style="font-size:10px; color:#7f8c8d; margin-bottom:4px;">${item.itemId}</p>${priceStr}${stockDisplay}`;
        
        btn.onclick = () => {
            if (isMenuLocked) return alert("Silakan masukkan Nomor WA atau pilih Pelanggan terlebih dahulu.");
            if (item.trackStock && item.currentStock <= 0) return alert("Stok item ini habis!");
            
            if (item.inputMode === "DECIMAL") {
                let w = prompt(`Masukkan Berat/Qty untuk ${item.name} (Bisa Koma):`, "1");
                if (w === null) return;
                let parsedW = parseFloat(w.replace(',', '.'));
                if (isNaN(parsedW) || parsedW <= 0) return alert("Input tidak valid!");
                if (item.hasMoq && parsedW < item.moqQty) {
                    if(!confirm(`Item ini memiliki Minimal Order ${item.moqQty}. Input Anda (${parsedW}) akan dihitung sebagai ${item.moqQty}. Lanjutkan?`)) return;
                    parsedW = item.moqQty;
                }
                addToCart(item, parsedW);
            } else if (item.inputMode === "NUMPAD") {
                activeNumpadItem = item; numpadValue = "0"; updateNumpadDisplay(); document.getElementById("numpad-modal").classList.remove("hidden");
            } else {
                let existing = currentCart.find(i => i.itemId === item.itemId);
                let checkQty = existing ? existing.qty + 1 : 1;
                if (item.hasMoq && checkQty < item.moqQty) {
                    alert(`Otomatis menyesuaikan ke Minimal Order: ${item.moqQty}`);
                    addToCart(item, item.moqQty - (existing ? existing.qty : 0));
                } else { addToCart(item, 1); }
            }
        };
        grid.appendChild(btn);
    });
}

function addToCart(item, qty) {
    let existing = currentCart.find(i => i.itemId === item.itemId);
    if (existing) { existing.qty += qty; } 
    else { currentCart.push({ ...item, qty: qty, originalPrice: item.price }); }
    window.renderCart();
}

window.numpadPress = function(num) { 
    if(numpadValue === "0" && num !== ".") numpadValue = num.toString(); 
    else numpadValue += num.toString(); 
    updateNumpadDisplay(); 
};
window.numpadDel = function() { 
    numpadValue = numpadValue.slice(0, -1); 
    if(numpadValue === "") numpadValue = "0"; 
    updateNumpadDisplay(); 
};
function updateNumpadDisplay() { 
    let d = document.getElementById("numpad-display"); 
    if(d) d.innerText = (activeNumpadItem ? activeNumpadItem.name : "") + " : " + numpadValue; 
}
window.numpadSubmit = function() {
    let val = parseFloat(numpadValue);
    if (isNaN(val) || val <= 0) { alert("Nominal tidak valid"); return; }
    if (activeNumpadItem.name.toLowerCase().includes("deposit") || activeNumpadItem.name.toLowerCase().includes("topup")) { addToCart(activeNumpadItem, val); } 
    else { let modifiedItem = { ...activeNumpadItem, price: val }; addToCart(modifiedItem, 1); }
    document.getElementById("numpad-modal").classList.add("hidden"); activeNumpadItem = null;
};

window.renderCart = function() {
    const list = document.getElementById("cart-items"); if(!list) return;
    list.innerHTML = ""; window.cartSubtotal = 0;
    currentCart.forEach((item, index) => {
        let lineTotal = item.qty * item.price; window.cartSubtotal += lineTotal;
        let qtyStr = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        list.innerHTML += `<div class="cart-item">
            <div style="flex:2;"><strong>${item.name}</strong><br><span style="color:#7f8c8d; font-size:11px;">Rp ${item.price.toLocaleString('id-ID')}</span></div>
            <div style="flex:1; text-align:center;">
                <button class="cart-qty-btn" onclick="updateCartQty(${index}, -1)">-</button>
                <span class="cart-qty">${qtyStr}</span>
                <button class="cart-qty-btn" onclick="updateCartQty(${index}, 1)">+</button>
            </div>
            <div style="flex:1; text-align:right; font-weight:bold;">Rp ${lineTotal.toLocaleString('id-ID')}</div>
        </div>`;
    });
    window.cartGrandTotal = window.cartSubtotal;
    let s = document.getElementById("cart-subtotal"); if(s) s.innerText = "Rp " + window.cartSubtotal.toLocaleString('id-ID');
    let g = document.getElementById("cart-grandtotal"); if(g) g.innerText = "Rp " + window.cartGrandTotal.toLocaleString('id-ID');
    document.getElementById("btn-checkout").disabled = currentCart.length === 0;
};

window.updateCartQty = function(index, delta) {
    let item = currentCart[index];
    if (item.inputMode === "DECIMAL") {
        let w = prompt("Masukkan berat/qty baru:", item.qty);
        if (w === null) return; let parsed = parseFloat(w.replace(',', '.'));
        if (isNaN(parsed) || parsed <= 0) { currentCart.splice(index, 1); } else { item.qty = parsed; }
    } else {
        item.qty += delta; if (item.qty <= 0) currentCart.splice(index, 1);
    }
    window.renderCart();
};

window.clearCart = function(force = false) { 
    if (currentCart.length === 0 && !force) return alert("Keranjang sudah kosong!");
    if (!force && !confirm("Apakah Anda yakin ingin membatalkan order (mengosongkan keranjang)?")) return;
    currentCart = []; window.renderCart();
    let pf = document.getElementById("pay-free"); if(pf) { if(pf.tagName === 'INPUT') pf.value = 0; else pf.innerText = 0; }
};

window.lockMenu = function() {
    isMenuLocked = true; let ab = document.getElementById("active-customer-banner"); if(ab) ab.classList.add("hidden");
    let cp = document.getElementById("cust-phone"); if(cp) { cp.value = ""; cp.readOnly = false; }
    let cn = document.getElementById("cust-name"); if(cn) { cn.value = ""; cn.readOnly = false; }
    activeCustomerProfile = null; window.clearCart(true); renderProductGrid();
};

window.unlockMenu = function(isGuest) {
    let phone = document.getElementById("cust-phone").value.trim().replace(/\D/g, '').replace(/^0+/, '');
    let name = document.getElementById("cust-name").value.trim();
    if (isGuest) { phone = "-"; name = "Walk-in"; activeCustomerProfile = null; proceedToUnlock(phone, name); } 
    else {
        if (!phone) return alert("Nomor WA wajib diisi (Min 9 angka).");
        if (phone.length < 9) return alert("Nomor WA terlalu pendek.");
        if (!name) return alert("Nama wajib diisi.");
        
        db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (e) => {
            activeCustomerProfile = e.target.result;
            if(!activeCustomerProfile) {
                activeCustomerProfile = { phone: phone, name: name, points: 0, freeCoins: 0, spent: 0, storedRewards: {} };
                alert(`✅ Member baru berhasil ditambahkan!\nNama: ${name}\nWA: 0${phone}`);
            }
            proceedToUnlock(phone, name);
        };
    }
};

function proceedToUnlock(phone, name) {
    isMenuLocked = false; renderProductGrid();
    let b = document.getElementById("active-customer-banner"); if(b) b.classList.remove("hidden");
    document.getElementById("ac-name").innerText = name;
    document.getElementById("ac-phone").innerText = phone === "-" ? "-" : "0" + phone;
    document.getElementById("cust-phone").readOnly = true; document.getElementById("cust-name").readOnly = true;
    let rBtn = document.getElementById("btn-rewards");
    if(rBtn) rBtn.style.display = phone === "-" ? "none" : "block";
    updateMemberStatsDisplay();
}

function updateMemberStatsDisplay() {
    if (!activeCustomerProfile || activeCustomerProfile.phone === "-") return;
    let s = document.getElementById("ac-stats");
    if(s) s.innerText = `Poin: ${Math.floor(activeCustomerProfile.points || 0)} | Koin Gratis: ${activeCustomerProfile.freeCoins || 0}`;
}

window.searchCustomer = function() {
    const input = document.getElementById("cust-phone").value.trim().replace(/\D/g, '').replace(/^0+/, '');
    const resBox = document.getElementById("autocomplete-results");
    if (input.length < 3) { resBox.classList.add("hidden"); resBox.style.display = "none"; return; }
    
    db.transaction(["members"], "readonly").objectStore("members").getAll().onsuccess = (e) => {
        const members = e.target.result;
        const matches = members.filter(m => m.phone && m.phone.includes(input));
        resBox.innerHTML = "";
        if (matches.length > 0) {
            matches.slice(0, 5).forEach(m => {
                let div = document.createElement("div"); div.className = "ac-item";
                div.innerText = `${m.name} (0${m.phone})`;
                div.onclick = () => { document.getElementById("cust-phone").value = "0" + m.phone; document.getElementById("cust-name").value = m.name; resBox.classList.add("hidden"); resBox.style.display = "none"; };
                resBox.appendChild(div);
            });
            resBox.classList.remove("hidden"); resBox.style.display = "block";
        } else { resBox.classList.add("hidden"); resBox.style.display = "none"; }
    };
};

window.openEditMember = function() {
    let prefill = (activeCustomerProfile && activeCustomerProfile.phone !== "-" && !activeCustomerProfile.isNoWA) ? activeCustomerProfile.phone : "";
    let preName = (activeCustomerProfile && activeCustomerProfile.name !== "Walk-in") ? activeCustomerProfile.name : "";
    let eop = document.getElementById("edit-old-phone"); if(eop) eop.value = prefill; 
    let enp = document.getElementById("edit-new-phone"); if(enp) enp.value = "";
    let enn = document.getElementById("edit-new-name"); if(enn) enn.value = preName;
    let mod = document.getElementById("edit-member-modal"); if(mod) mod.classList.remove("hidden");
};

window.submitEditMember = function() {
    let eop = document.getElementById("edit-old-phone"); let oldPhone = eop ? eop.value.trim().replace(/\D/g, '').replace(/^0+/, '') : ""; 
    let enp = document.getElementById("edit-new-phone"); let newPhone = enp ? enp.value.trim().replace(/\D/g, '').replace(/^0+/, '') : "";
    let enn = document.getElementById("edit-new-name"); let newName = enn ? enn.value.trim() : "";
    
    if(!oldPhone || !newPhone) return alert("Nomor WA tidak boleh kosong.");

    db.transaction(["members"], "readonly").objectStore("members").get(oldPhone).onsuccess = (e) => {
        let member = e.target.result; if (!member) return alert("Nomor lama tidak ditemukan di database.");
        db.transaction(["phone_updates"], "readwrite").objectStore("phone_updates").add({ id: "UPD-" + Date.now(), oldPhone: oldPhone, newPhone: newPhone, newName: newName, syncStatus: "Pending" });
        
        member.phone = newPhone; if (newName) member.name = newName;
        let tx = db.transaction(["members"], "readwrite");
        tx.objectStore("members").delete(oldPhone); tx.objectStore("members").put(member);
        alert("Data Member berhasil diubah!"); window.lockMenu(); 
        let mod = document.getElementById("edit-member-modal"); if(mod) mod.classList.add("hidden");
        window.runBackgroundSync();
    };
};

window.openRewardsModal = function() {
    if (!activeCustomerProfile) return;
    let list = document.getElementById("rewards-list"); if(!list) return; list.innerHTML = "";
    let cFree = activeCustomerProfile.freeCoins || 0;
    
    let loyaltyHtml = `
    <div style="background:#f1f8e9; padding:10px; border-radius:6px; border:1px solid #c5e1a5; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
        <div><strong>Koin Gratis (Loyalty)</strong><br><small>Tersedia: ${cFree} Koin</small></div>
        <input type="number" min="0" max="${cFree}" value="0" class="promo-input" data-type="loyalty" data-item="Koin_Fisik" data-price="${activeCoinPrice}" style="width:60px; padding:6px; font-weight:bold; text-align:center;">
    </div>`;
    list.innerHTML += loyaltyHtml;
    
    let stored = activeCustomerProfile.storedRewards || {};
    for (let [item, qty] of Object.entries(stored)) {
        if (qty > 0) {
            let pData = window.globalMenuData.find(m => m.name === item);
            let itemPrice = pData ? pData.price : 0;
            list.innerHTML += `
            <div style="background:#e8f4f8; padding:10px; border-radius:6px; border:1px solid #bce8f1; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                <div><strong>Hadiah: ${item}</strong><br><small>Tersedia: ${qty}x</small></div>
                <input type="number" min="0" max="${qty}" value="0" class="promo-input" data-type="stored" data-item="${item}" data-price="${itemPrice}" style="width:60px; padding:6px; font-weight:bold; text-align:center;">
            </div>`;
        }
    }
    document.getElementById("rewards-modal").classList.remove("hidden");
};

window.applyRewards = function() {
    let totalDiscount = 0; let promoNames = [];
    document.querySelectorAll('.promo-input').forEach(input => {
        let val = Number(input.value) || 0;
        if (val > 0) {
            totalDiscount += (val * Number(input.getAttribute('data-price')));
            promoNames.push(`${val}x ${input.getAttribute('data-item')}`);
        }
    });
    let pf = document.getElementById("pay-free"); if(pf) pf.value = totalDiscount;
    document.getElementById("rewards-modal").classList.add("hidden");
    
    let sec = document.getElementById("review-promo-section");
    if (sec) {
        if (promoNames.length > 0) {
            sec.innerHTML = `<span style="font-weight:bold; color:#d35400;">🎁 Promo Dipakai:</span> <span style="font-size:12px;">${promoNames.join(', ')}</span>`;
            sec.style.display = "block";
        } else { sec.style.display = "none"; }
    }
    if (document.getElementById("review-modal").classList.contains("hidden") === false) { window.calculateRemaining(false); }
    else { alert("Reward siap digunakan. Lanjutkan ke Pembayaran."); }
};

window.openLotteryModal = function() {
    if (!activeCustomerProfile) return alert("Harap pilih profil pelanggan terlebih dahulu.");
    const select = document.getElementById("lottery-select");
    if(select) { 
        select.innerHTML = '-- Pilih Promo Undian --';
        let currentOutlet = window.currentOutlet || "Pusat";
        window.globalPromos.forEach(p => { 
            let usedInOutlet = p.usedQuotaJson ? (p.usedQuotaJson[currentOutlet] || 0) : 0;
            if(p.weeklyQuota === 0 || usedInOutlet < p.weeklyQuota) { 
                select.innerHTML += `<option value="${p.code}">${p.code} (${p.rewardItem})</option>`; 
            } 
        });
    } 
    let desc = document.getElementById("lottery-desc"); if(desc) desc.innerHTML = ""; 
    let mod = document.getElementById("lottery-modal"); if(mod) mod.classList.remove("hidden"); 
};

window.changeLotterySelection = function() {
    let code = document.getElementById("lottery-select").value; let p = window.globalPromos.find(x => x.code === code);
    let desc = document.getElementById("lottery-desc");
    if(p && desc) { desc.innerHTML = `<div style="padding:10px; background:#e8f4f8; border-radius:6px; font-size:12px;"><strong>Mendapatkan:</strong> ${p.rewardQty}x ${p.rewardItem}</div>`; } 
    else if(desc) { desc.innerHTML = ""; }
};

window.submitLottery = function() {
    let code = document.getElementById("lottery-select").value;
    if(!code || code.startsWith("--")) return alert("Pilih promo undian terlebih dahulu.");
    antreans[currentAntreanIndex].pendingPromoCode = code;
    document.getElementById("lottery-modal").classList.add("hidden");
    alert("Klaim Undian berhasil disiapkan. Hadiah akan masuk ke profil member setelah pesanan ini dibayar dan diselesaikan.");
};

window.checkout = function() {
    if (currentCart.length === 0) return;
    document.getElementById("review-subtotal").innerText = "Rp " + window.cartSubtotal.toLocaleString('id-ID');
    document.getElementById("review-grandtotal").innerText = "Rp " + window.cartGrandTotal.toLocaleString('id-ID');
    
    document.getElementById("pay-cash").value = window.cartGrandTotal;
    document.getElementById("pay-qris").value = 0;
    let pt = document.getElementById("pay-transfer"); if(pt) pt.value = 0;
    document.getElementById("pay-hotel-piutang").value = 0;
    document.getElementById("pay-tamu-piutang").value = 0;
    
    window.calculateRemaining(false);
    document.getElementById("review-modal").classList.remove("hidden");
};

window.closeReview = function() { document.getElementById("review-modal").classList.add("hidden"); };

window.calculateRemaining = function(isCashManual = false) {
    let elQ = document.getElementById("pay-qris"); let q = elQ ? Number(elQ.value) : 0;
    let elHP = document.getElementById("pay-hotel-piutang"); let hp = elHP ? Number(elHP.value) : 0;
    let elTP = document.getElementById("pay-tamu-piutang"); let tp = elTP ? Number(elTP.value) : 0;
    
    let pc = document.getElementById("pay-cash"); 
    let c = pc ? Number(pc.value) : 0;

    if (!isCashManual) {
        let autoCash = window.cartGrandTotal - (q + hp + tp);
        c = Math.max(0, autoCash);
        if (pc) pc.value = c;
    }

    const totalAccounted = c + q + hp + tp; 
    const remaining = Math.max(0, window.cartGrandTotal - totalAccounted);
    
    let rr = document.getElementById("review-remaining");
    let rrContainer = document.getElementById("review-remaining-container");
    let rrLabel = document.getElementById("review-remaining-label");
    
    if(rr && rrContainer && rrLabel) {
        rr.innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
        if (remaining > 0) {
            rrContainer.style.background = "#f8d7da"; rrContainer.style.border = "1px solid #f5c6cb";
            rrContainer.style.color = "#721c24"; rrLabel.innerText = "⚠️ Sisa Kurang Bayar:";
        } else {
            rrContainer.style.background = "#d4edda"; rrContainer.style.border = "1px solid #c3e6cb";
            rrContainer.style.color = "#155724"; rrLabel.innerText = "✅ Pembayaran Lunas:";
        }
    }
};

window.finalizeOrder = async function(shouldPrint) {
    let pc = document.getElementById("pay-cash"); let cash = pc ? Number(pc.value) : 0;
    let elQ = document.getElementById("pay-qris"); let qris = elQ ? Number(elQ.value) : 0;
    let elHP = document.getElementById("pay-hotel-piutang"); let hotelPiutang = elHP ? Number(elHP.value) : 0;
    let elTP = document.getElementById("pay-tamu-piutang"); let tamuPiutang = elTP ? Number(elTP.value) : 0;
    let pf = document.getElementById("pay-free"); let free = pf ? Number(pf.value) : 0;
    
    const totalPiutang = hotelPiutang + tamuPiutang; 
    if ((window.cartGrandTotal - (cash + qris + totalPiutang)) > 0) return alert("⚠️ Pembayaran Belum Cukup!");

    const targetOrderId = "ORD-" + Date.now();

    let payMethod = ""; let activeMethods = [];
    if (cash > 0) activeMethods.push("Cash");
    if (qris > 0) activeMethods.push("QRIS");
    if (hotelPiutang > 0) activeMethods.push("Piutang Hotel");
    if (tamuPiutang > 0) activeMethods.push("Piutang Tamu");
    if (free > 0) activeMethods.push("Gratis");

    if (activeMethods.length === 1) payMethod = activeMethods[0];
    else if (activeMethods.length === 0) payMethod = "Unpaid";
    else payMethod = activeMethods.join(" + ");

    let redeemedList = []; let redeemedLoyaltyCoins = 0;
    document.querySelectorAll('.promo-input').forEach(input => {
        let val = Number(input.value) || 0;
        if (val > 0) {
            let src = input.getAttribute('data-type');
            redeemedList.push({ source: src, item: input.getAttribute('data-item'), qty: val, price: Number(input.getAttribute('data-price')) });
            if (src === 'loyalty') redeemedLoyaltyCoins += val;
        }
    });

    let cp = document.getElementById("cust-phone"); let custPhone = cp ? cp.value.trim() : "-"; if(!custPhone) custPhone = "-";
    let cn = document.getElementById("cust-name"); let custName = cn ? cn.value.trim() : "Walk-in"; if(!custName) custName = "Walk-in";
    let newPoints = 0; let newFree = 0;

    let cartCoins = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    let paidCoins = Math.max(0, cartCoins - redeemedLoyaltyCoins);

    const settings = await window.getDynamicSettings();
    let kesetPerBatch = Number(settings["Keset_Per_Batch"]) || 5; 
    let bantalPerBatch = Number(settings["Sarung_Bantal_Per_Batch"]) || 10;
    let kgPerCuci = Number(settings["Kilo_Per_Koin_Cuci"]) || 5;
    let kgPerKering = Number(settings["Kilo_Per_Koin_Kering"]) || 5;

    let regularWeight = 0; let kesetQty = 0; let bantalQty = 0; let otherCoins = 0; 
    let koinSoldQty = 0;

    currentCart.forEach(item => {
        let name = String(item.name).toUpperCase();
        if (name.includes("KOIN")) { koinSoldQty += item.qty; } 
        else if (name.includes("KESET")) { kesetQty += item.qty; } 
        else if (name.includes("BANTAL")) { bantalQty += item.qty; } 
        else if (item.inputMode === "DECIMAL") { regularWeight += item.qty; } 
        else {
            let divisor = (item.hasMoq && item.moqQty > 0) ? item.moqQty : 1; 
            let multiplier = Math.ceil(item.qty / divisor); 
            otherCoins += ((item.expectedCoins || 0) * multiplier);
        }
    });

    let assumedWashingCoins = (regularWeight > 0 ? (Math.ceil(regularWeight / kgPerCuci) + Math.ceil(regularWeight / kgPerKering)) : 0) + (kesetQty > 0 ? Math.ceil(kesetQty / kesetPerBatch) * 3 : 0) + (bantalQty > 0 ? Math.ceil(bantalQty / bantalPerBatch) * 2 : 0) + otherCoins;
    let expectedCoinsTotal = assumedWashingCoins + koinSoldQty;

    let newEarnedRewards = [];
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";

    if (custPhone !== "-") {
        if (!activeCustomerProfile) activeCustomerProfile = { phone: custPhone, name: custName, points: 0, freeCoins: 0, spent: 0, storedRewards: {} };
        activeCustomerProfile.spent += window.cartGrandTotal;
        let initialPoints = activeCustomerProfile.points || 0; let initialFree = activeCustomerProfile.freeCoins || 0;
        let totalPoints = initialPoints + paidCoins; let newlyEarnedFree = Math.floor(totalPoints / window.loyaltyTarget);
        let remainingPoints = totalPoints % window.loyaltyTarget; let finalFreeCoins = Math.max(0, (initialFree + newlyEarnedFree) - redeemedLoyaltyCoins);

        redeemedList.forEach(rp => {
            if (rp.source === 'stored' && activeCustomerProfile.storedRewards && activeCustomerProfile.storedRewards[rp.item] !== undefined) {
                activeCustomerProfile.storedRewards[rp.item] -= rp.qty;
                if (activeCustomerProfile.storedRewards[rp.item] <= 0) delete activeCustomerProfile.storedRewards[rp.item]; 
            }
        });

        let pendingPromoCode = antreans[currentAntreanIndex].pendingPromoCode;
        if (pendingPromoCode) {
            let promo = window.globalPromos.find(p => p.code === pendingPromoCode);
            if (promo) {
                newEarnedRewards.push({ item: promo.rewardItem, qty: promo.rewardQty, code: promo.code });
                if (!activeCustomerProfile.storedRewards) activeCustomerProfile.storedRewards = {};
                activeCustomerProfile.storedRewards[promo.rewardItem] = (activeCustomerProfile.storedRewards[promo.rewardItem] || 0) + promo.rewardQty;
                let d = new Date(); let todayStr = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0') + "-" + String(d.getDate()).padStart(2,'0');
                activeCustomerProfile.lastClaimDate = todayStr; 
                db.transaction(["promo_claims"], "readwrite").objectStore("promo_claims").add({ claimId: "CLM-" + Date.now(), timestamp: todayStr + "T" + d.toLocaleTimeString('en-GB'), phone: activeCustomerProfile.phone, code: pendingPromoCode, rewardItem: promo.rewardItem, rewardQty: promo.rewardQty, cashier: currentCashier || "Unknown", shiftId: currentShiftId, orderId: targetOrderId, outlet: currentOutlet, syncStatus: "Pending" });
            }
        }
        antreans[currentAntreanIndex].pendingPromoCode = null;
        activeCustomerProfile.points = remainingPoints; activeCustomerProfile.freeCoins = finalFreeCoins; newPoints = remainingPoints; newFree = finalFreeCoins; window.saveMemberToDB(activeCustomerProfile);
    }

    let isLaundry = currentCart.some(i => i.workflow === "TICKET");
    let finalStatus = isLaundry ? "Processing" : (totalPiutang > 0 ? "Pending Debt" : "Completed");

    const orderPayload = {
        orderId: targetOrderId, timestamp: new Date().toISOString(), cashier: currentCashier || "Unknown", shiftId: currentShiftId,
        customerName: custName, customerPhone: custPhone, orderStatus: finalStatus, items: currentCart, subtotal: window.cartSubtotal, discounts: free, grandTotal: window.cartGrandTotal,
        paymentMethod: payMethod, cashAmount: cash, qrisAmount: qris, transferAmount: 0, hotelPiutangAmount: hotelPiutang, tamuPiutangAmount: tamuPiutang, freeAmount: free, remainingDue: 0,
        coinsEarned: paidCoins, redeemedPromos: redeemedList, newEarnedRewards: newEarnedRewards, expectedCoins: expectedCoinsTotal, washingCoins: assumedWashingCoins, instantCoins: koinSoldQty, 
        actualCoins: isLaundry ? 0 : expectedCoinsTotal, // Aktual Otomatis jika Instant
        outlet: currentOutlet, syncStatus: "Pending" 
    };

    let tx = db.transaction(["orders"], "readwrite");
    tx.objectStore("orders").add(orderPayload);
    
    tx.oncomplete = async () => {
        if (finalStatus === "Processing" || hotelPiutang > 0 || tamuPiutang > 0) {
            activeLaundryTickets.unshift(orderPayload);
            let tc = document.getElementById("ticket-count"); if(tc) tc.innerText = activeLaundryTickets.filter(t => t.orderStatus === "Processing" || t.orderStatus === "Ready for Pickup").length;
            let pc = document.getElementById("piutang-count"); if(pc) pc.innerText = activeLaundryTickets.filter(t => t.hotelPiutangAmount > 0 || t.tamuPiutangAmount > 0).length;
        }
        
        if (shouldPrint) {
            if (typeof window.buildEscPosReceipt === "function" && typeof btCharacteristic !== "undefined" && btCharacteristic) {
                try {
                    await window.buildEscPosReceipt(orderPayload.orderId, orderPayload, (cash + qris + totalPiutang), 0, payMethod, newPoints, newFree);
                    alert("✅ Order has been recorded & printed!");
                } catch (e) { alert("⚠️ Gagal mencetak: Printer error/terputus. Order has been recorded."); }
            } else { alert("⚠️ Printer Bluetooth belum terhubung! Order has been recorded."); }
        } else {
            alert("✅ Order has been recorded!"); 
        }

        window.clearCart(true); 
        let mod = document.getElementById("review-modal"); if(mod) mod.classList.add("hidden");
        window.renderActiveTickets(); 
        window.renderPiutangTickets(); 
        window.switchWorkspace('new'); 
        window.lockMenu(); 
        window.runBackgroundSync();
    };
};

window.saveMemberToDB = function(profile) {
    db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").put(profile);
    db.transaction(["members"], "readwrite").objectStore("members").put(profile);
    window.runBackgroundSync();
};

window.switchWorkspace = function(type) {
    document.querySelectorAll('.ws-tab').forEach(b => b.classList.remove('active'));
    let mainWs = document.getElementById("main-workspace-wrapper");
    let ticketWs = document.getElementById("active-tickets-workspace");
    let piutangWs = document.getElementById("piutang-workspace");
    if(mainWs) mainWs.classList.add("hidden"); if(ticketWs) ticketWs.classList.add("hidden"); if(piutangWs) piutangWs.classList.add("hidden");

    if (type === 'new') {
        let tab = document.getElementById("tab-new-order"); if(tab) tab.classList.add("active");
        if(mainWs) mainWs.classList.remove("hidden");
    } else if (type === 'tickets') {
        let tab = document.getElementById("tab-active-tickets"); if(tab) tab.classList.add("active");
        if(ticketWs) ticketWs.classList.remove("hidden"); window.renderActiveTickets(); 
    } else if (type === 'piutang') {
        let tab = document.getElementById("tab-piutang"); if(tab) tab.classList.add("active");
        if(piutangWs) piutangWs.classList.remove("hidden"); window.renderPiutangTickets();
    }
};

window.renderActiveTickets = function() {
    const grid = document.getElementById("ticket-grid-container"); if(!grid) return;
    grid.innerHTML = "";
    let tickets = activeLaundryTickets.filter(t => t.orderStatus === "Processing" || t.orderStatus === "Ready for Pickup");
    if(tickets.length === 0) return grid.innerHTML = "<p>Tidak ada cucian aktif.</p>";
    
    tickets.forEach((ticket) => {
        const isReady = ticket.orderStatus === "Ready for Pickup";
        let receiptText = ticket.readableReceipt || (ticket.items ? ticket.items.map(i => `${i.qty % 1 !== 0 ? i.qty.toFixed(2) : i.qty}x ${i.name}`).join('\n') : "");
        let expectedWashing = ticket.washingCoins || 0; 
        
        let buttonsHtml = !isReady ? `<button class="ticket-btn" style="background:#f39c12;" onclick="window.markTicketReady('${ticket.orderId}', ${expectedWashing})">Tandai Selesai Cuci</button>` : `<button class="ticket-btn" style="background:#2ecc71;" onclick="window.openSettlement('${ticket.orderId}', 0)">Ambil & Selesai</button>`;
        grid.innerHTML += `<div class="ticket-card ${isReady ? 'ready' : ''}"><div class="ticket-header"><span>${ticket.customerName}</span> <span style="font-size:11px;">${ticket.orderId}</span></div><div style="font-size:13px; margin-bottom:10px; white-space:pre-wrap;">${receiptText}</div>${buttonsHtml}</div>`;
    });
};

window.renderPiutangTickets = function() {
    const grid = document.getElementById("piutang-grid-container"); if(!grid) return;
    grid.innerHTML = "";
    let tickets = activeLaundryTickets.filter(t => (t.hotelPiutangAmount > 0 || t.tamuPiutangAmount > 0));
    if(tickets.length === 0) return grid.innerHTML = "<p>Tidak ada tagihan piutang aktif.</p>";
    
    tickets.forEach((ticket) => {
        const remaining = (ticket.hotelPiutangAmount || 0) + (ticket.tamuPiutangAmount || 0);
        let btn = `<button class="ticket-btn" style="background:#e74c3c;" onclick="window.openPiutangPayment('${ticket.orderId}', ${remaining})">Bayar Piutang</button>`;
        grid.innerHTML += `<div class="ticket-card"><div class="ticket-header"><span>${ticket.customerName}</span> <span style="font-size:11px;">${ticket.orderId}</span></div><div style="font-size:16px; font-weight:bold; margin-top:5px; color:#c0392b;">Sisa: Rp ${remaining.toLocaleString('id-ID')}</div>${btn}</div>`;
    });
};

window.markTicketReady = function(orderId, expectedWashing) {
    window.activeDoneOrderId = orderId;
    let elExpected = document.getElementById("done-expected-coins"); if (elExpected) elExpected.innerText = expectedWashing;
    let elActual = document.getElementById("done-actual-coins"); if (elActual) elActual.value = expectedWashing; 
    let modal = document.getElementById("ticket-done-modal"); if (modal) modal.classList.remove("hidden");
};

window.submitTicketDone = function() {
    let actualWashingInput = Number(document.getElementById("done-actual-coins").value) || 0;
    let expectedWashing = Number(document.getElementById("done-expected-coins").innerText) || 0;
    if (actualWashingInput < 0) return alert("Jumlah koin tidak valid.");

    const ticket = activeLaundryTickets.find(t => t.orderId === window.activeDoneOrderId);
    if (ticket) {
        ticket.orderStatus = "Ready for Pickup"; 
        let instantC = ticket.instantCoins || 0;
        ticket.actualCoins = actualWashingInput + instantC; // Gabungkan kembali Aktual Total
        
        if (actualWashingInput !== expectedWashing) { ticket.coinDiscrepancy = true; } 
        
        ticket.syncStatus = "Pending";
        db.transaction(["orders"], "readwrite").objectStore("orders").put(ticket);
        window.renderActiveTickets(); window.runBackgroundSync();
    }
    document.getElementById("ticket-done-modal").classList.add("hidden");
};

window.openSettlement = function(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    let st = document.getElementById("settle-amount"); if(st) st.innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    let c = document.getElementById("settle-cash"); if(c) c.value = remainingDue;
    let q = document.getElementById("settle-qris"); if(q) q.value = 0;
    let mod = document.getElementById("settlement-modal"); if(mod) mod.classList.remove("hidden");
};

window.confirmSettlement = function() {
    if (!activeSettlementTicket) return;
    const c = Number(document.getElementById("settle-cash").value) || 0; 
    const q = Number(document.getElementById("settle-qris").value) || 0; 
    activeSettlementTicket.cashAmount = (activeSettlementTicket.cashAmount || 0) + c; 
    activeSettlementTicket.qrisAmount = (activeSettlementTicket.qrisAmount || 0) + q; 
    activeSettlementTicket.orderStatus = "Completed"; activeSettlementTicket.syncStatus = "Pending";
    db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
    activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
    let mod = document.getElementById("settlement-modal"); if(mod) mod.classList.add("hidden"); 
    
    let tc = document.getElementById("ticket-count"); if(tc) tc.innerText = activeLaundryTickets.filter(t => t.orderStatus === "Processing" || t.orderStatus === "Ready for Pickup").length;
    window.renderActiveTickets(); window.runBackgroundSync();
};

window.openPiutangPayment = function(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    let st = document.getElementById("piutang-settle-amount"); if(st) st.innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    let c = document.getElementById("piutang-settle-cash"); if(c) c.value = remainingDue;
    let q = document.getElementById("piutang-settle-qris"); if(q) q.value = 0;
    let mod = document.getElementById("piutang-payment-modal"); if(mod) mod.classList.remove("hidden");
};

window.confirmPiutangPayment = function() {
    if (!activeSettlementTicket) return;
    const c = Number(document.getElementById("piutang-settle-cash").value) || 0; 
    const q = Number(document.getElementById("piutang-settle-qris").value) || 0; 
    activeSettlementTicket.cashAmount = (activeSettlementTicket.cashAmount || 0) + c; 
    activeSettlementTicket.qrisAmount = (activeSettlementTicket.qrisAmount || 0) + q; 
    activeSettlementTicket.hotelPiutangAmount = 0; activeSettlementTicket.tamuPiutangAmount = 0;
    activeSettlementTicket.orderStatus = "Completed"; activeSettlementTicket.piutangPaidDate = new Date().toISOString(); activeSettlementTicket.syncStatus = "Pending";
    db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
    activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
    let mod = document.getElementById("piutang-payment-modal"); if(mod) mod.classList.add("hidden"); 
    
    let pc = document.getElementById("piutang-count"); if(pc) pc.innerText = activeLaundryTickets.filter(t => t.hotelPiutangAmount > 0 || t.tamuPiutangAmount > 0).length;
    window.renderPiutangTickets(); window.runBackgroundSync();
};

window.openExpenseModal = function() { 
    document.getElementById("expense-modal").classList.remove("hidden"); 
    const list = document.getElementById("expense-category-list");
    if(list && window.expenseCategories) { 
        list.innerHTML = ""; window.expenseCategories.forEach(cat => { const opt = document.createElement("option"); opt.value = cat; list.appendChild(opt); }); 
    } 
};

window.saveExpense = function() { 
    const amount = Number(document.getElementById("exp-amount").value); const category = document.getElementById("exp-category").value.trim();
    if (amount <= 0 || !category) return alert("Harap masukkan jumlah dan kategori yang benar."); 
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { expenseId: "EXP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, category: category, description: document.getElementById("exp-desc").value || "-", amount: amount, status: "Active", outlet: currentOutlet, syncStatus: "Pending" }; 
    db.transaction(["expenses"], "readwrite").objectStore("expenses").add(payload); 
    document.getElementById("expense-modal").classList.add("hidden"); document.getElementById("exp-amount").value = ""; document.getElementById("exp-category").value = ""; document.getElementById("exp-desc").value = ""; 
    alert("Pengeluaran Berhasil Dicatat!"); window.runBackgroundSync(); 
};

window.saveCoinRetrieval = function() { 
    const qty = Number(document.getElementById("coin-retrieval-qty").value); if (qty <= 0) return alert("Jumlah koin tidak valid.");
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { retrievalId: "RET-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, qty: qty, notes: "Daur Ulang Koin Fisik", outlet: currentOutlet, syncStatus: "Pending" };
    db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload); 
    document.getElementById("coin-retrieval-qty").value = ""; alert("Pengambilan koin tercatat (Menunggu Approval)"); window.runBackgroundSync(); 
};

window.saveCoinJammed = function() { 
    const qty = Number(document.getElementById("coin-jammed-qty").value); if (qty <= 0) return alert("Jumlah koin tidak valid.");
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { retrievalId: "JAM-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, qty: qty, notes: "Mesin Macet / Tertelan", outlet: currentOutlet, syncStatus: "Pending" };
    db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload); 
    document.getElementById("coin-jammed-qty").value = ""; alert("Koin macet tercatat!"); window.runBackgroundSync(); 
};

window.submitCashDrop = function() { 
    const admin = Number(document.getElementById("drop-admin").value) || 0; const bank = Number(document.getElementById("drop-bank").value) || 0; const drawer = Number(document.getElementById("drop-drawer").value) || 0;
    if (admin === 0 && bank === 0) return alert("Masukkan nominal setor uang."); 
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { dropId: "DRP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, toAdmin: admin, toBank: bank, leftInDrawer: drawer, notes: document.getElementById("drop-notes").value || "-", outlet: currentOutlet, syncStatus: "Pending" };
    db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").add(payload); document.getElementById("cashdrop-modal").classList.add("hidden");
    document.getElementById("drop-admin").value = ""; document.getElementById("drop-bank").value = ""; document.getElementById("drop-drawer").value = ""; document.getElementById("drop-notes").value = "";
    alert("Setoran berhasil dicatat!"); window.runBackgroundSync(); 
};

window.attemptLogin = async function() {
    const pinInput = document.getElementById("cashier-pin"); const rawPin = pinInput.value.trim(); if (!rawPin) return; 
    let loginBtn = document.getElementById("btn-login"); if(loginBtn) loginBtn.innerText = "Memverifikasi...";

    try {
        const hashedPin = await hashString(rawPin);
        let staff = await new Promise(res => db.transaction(["staff"], "readonly").objectStore("staff").get(hashedPin).onsuccess = e => res(e.target.result));
        if (!staff && navigator.onLine) { 
            if(loginBtn) loginBtn.innerText = "Menarik Data Baru...";
            await window.syncInitData(); 
            let staffList = await new Promise(res => db.transaction(["staff"], "readonly").objectStore("staff").getAll().onsuccess = e => res(e.target.result));
            staff = staffList.find(s => s.pin === hashedPin);
        }

        if (staff) {
            if (!window.availableOutlets) window.availableOutlets = ["Pusat"];
            let allowedOutlets = staff.outlets ? staff.outlets.split(',').map(s=>s.trim()).filter(s=>s) : window.availableOutlets;
            let selectedOutlet = document.getElementById("outlet-select") ? document.getElementById("outlet-select").value : null;
            if (!selectedOutlet || !allowedOutlets.includes(selectedOutlet)) { selectedOutlet = allowedOutlets.length > 0 ? allowedOutlets[0] : (window.availableOutlets.length > 0 ? window.availableOutlets[0] : "Pusat"); }
            localStorage.setItem("selectedOutlet", selectedOutlet); window.currentOutlet = selectedOutlet;
            
            let localMenu = await new Promise(res => db.transaction(["menu"], "readonly").objectStore("menu").getAll().onsuccess = e => res(e.target.result));
            window.globalMenuDataRaw = localMenu || [];
            window.globalMenuData = window.globalMenuDataRaw.map(m => {
                let sJson = {}; try { sJson = JSON.parse(m.stockJson); } catch(e){}
                m.currentStock = Number(sJson[selectedOutlet]) || 0; return m;
            }).filter(m => {
                if (!m.outlets) return true; let outs = m.outlets.split(',').map(s=>s.trim().toLowerCase());
                if (outs.length === 0 || outs.includes("")) return true; return outs.includes(selectedOutlet.toLowerCase());
            }).sort((a, b) => String(a.itemId).localeCompare(String(b.itemId)));

            db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").get(hashedPin).onsuccess = (shiftReq) => {
                const activeShift = shiftReq.target.result; currentCashier = staff.name; currentPin = hashedPin;
                if (activeShift) { currentShiftId = activeShift.shiftId; currentLoginTime = activeShift.loginTime; } 
                else { currentShiftId = "SHF-" + Date.now(); currentLoginTime = new Date().toISOString(); db.transaction(["active_shifts"], "readwrite").objectStore("active_shifts").put({pin: hashedPin, shiftId: currentShiftId, loginTime: currentLoginTime, lastActiveTime: Date.now(), cashierName: currentCashier}); }
                
                let btnKoin = document.getElementById("btn-koin-top");
                if (btnKoin) btnKoin.innerHTML = `🪙 Laci: ${window.laciStocks ? (window.laciStocks[selectedOutlet] || 0) : 0} | Mesin: ${window.coinsInMachines ? (window.coinsInMachines[selectedOutlet] || 0) : 0}`;

                document.getElementById("login-screen").classList.add("hidden"); document.getElementById("pos-screen").classList.remove("hidden");
                document.getElementById("display-cashier").innerText = currentCashier + ` (${selectedOutlet})`;
                window.switchWorkspace('new'); window.lockMenu(); loadMenuUI();
            };
        } else { alert("PIN Kasir Salah atau Belum Terdaftar!"); }
    } catch (err) { alert("Terjadi kesalahan sistem login."); } finally { pinInput.value = ""; if(loginBtn) loginBtn.innerText = "Masuk / Buka Shift"; }
};

window.openHistoryList = function() {
    document.getElementById("history-list-modal").classList.remove("hidden");
    window.renderHistoryList('transactions');
};

window.renderHistoryList = function(type) {
    const container = document.getElementById("history-list-container"); container.innerHTML = "Memuat data...";
    document.querySelectorAll('.history-tab').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-hist-${type}`).classList.add('active');

    if (type === 'transactions') {
        db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
            const filtered = e.target.result.filter(o => o.cashier === currentCashier && o.shiftId === currentShiftId).reverse();
            if(filtered.length === 0) { container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada transaksi di shift ini.</div>`; return; }
            container.innerHTML = "";
            filtered.forEach(o => {
                let badge = `<span style="background:#27ae60; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">${o.orderStatus}</span>`;
                if(o.orderStatus.includes("Void")) badge = `<span style="background:#e74c3c; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">Void</span>`;
                else if(o.orderStatus.includes("Debt")) badge = `<span style="background:#f39c12; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">Piutang</span>`;
                
                let voidBtn = o.orderStatus.includes("Void") ? "" : `<button onclick="window.requestVoid('${o.orderId}', 'orders')" style="background:#c0392b; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Batalkan</button>`;
                container.innerHTML += `<div class="history-row" style="align-items:flex-start; display:flex; justify-content:space-between;">
                    <div><strong>${o.customerName}</strong> <span style="font-size:11px; color:#7f8c8d;">${o.orderId}</span><br><small>${new Date(o.timestamp).toLocaleTimeString('id-ID')} | Rp ${o.grandTotal.toLocaleString('id-ID')}</small></div>
                    <div style="text-align:right;">${badge}<div style="margin-top:5px; display:flex; gap:5px; justify-content:flex-end;">${voidBtn} <button onclick="window.reprintOrder('${o.orderId}')" style="background:#3498db; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Print</button></div></div>
                </div>`;
            });
        };
    } else if (type === 'expenses') {
        db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = (e) => {
            const filtered = e.target.result.filter(o => o.cashier === currentCashier && o.shiftId === currentShiftId).reverse();
            if(filtered.length === 0) { container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada pengeluaran di shift ini.</div>`; return; }
            container.innerHTML = "";
            filtered.forEach(o => {
                let badge = o.status.includes("Void") ? `<span style="background:#e74c3c; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">Void</span>` : `<span style="background:#27ae60; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">Active</span>`;
                let voidBtn = o.status.includes("Void") ? "" : `<button onclick="window.requestVoid('${o.expenseId}', 'expenses')" style="background:#c0392b; color:white; border:none; padding:4px 8px; border-radius:4px; cursor:pointer; font-size:11px;">Batalkan</button>`;
                container.innerHTML += `<div class="history-row" style="align-items:flex-start; display:flex; justify-content:space-between;">
                    <div><strong>${o.category}</strong> <span style="font-size:11px; color:#7f8c8d;">${o.expenseId}</span><br><small>${o.description}</small></div>
                    <div style="text-align:right;">${badge}<br><strong style="font-size:14px; color:#e74c3c; display:block; margin:4px 0;">Rp ${o.amount.toLocaleString('id-ID')}</strong>${voidBtn}</div>
                </div>`;
            });
        };
    } else if (type === 'shifts') {
        const renderShiftsHTML = (shiftsData) => {
            const filtered = shiftsData.filter(s => s.cashier === currentCashier).slice(0, 6);
            if(filtered.length === 0) { container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada histori shift Anda di sistem.</div>`; return; }
            container.innerHTML = "";
            filtered.forEach(s => {
                let detailBtn = `<button onclick="window.viewShiftDetails('${s.shiftId}')" style="background:#f39c12; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">👁️ Detail</button>`;
                let printBtn = `<button onclick="window.printShiftReportFromHistory('${s.shiftId}')" style="background:#3498db; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">🖨️ Cetak</button>`;
                let itemsStr = "Tidak ada item"; if (s.foodSummary && Object.keys(s.foodSummary).length > 0) itemsStr = Object.entries(s.foodSummary).map(([k,v]) => `${v}x ${k}`).join(', ');
                container.innerHTML += `<div class="history-row" style="align-items:flex-start; display:flex; gap:10px;">
                    <div style="flex:2;"><strong>Shift: ${s.shiftId}</strong><br><small style="color:#7f8c8d;">Keluar: ${formatWIB(s.logoutTime)}</small><br><small style="color:#2980b9; display:block; margin-top:4px; line-height:1.4;">📦 <strong>Item:</strong> ${itemsStr}</small></div>
                    <div style="flex:1; text-align:right;"><strong style="color:#27ae60; display:block; margin-bottom:6px; font-size:14px;">Rp ${(s.totalOmset || 0).toLocaleString('id-ID')}</strong><div style="display:flex; justify-content:flex-end; gap:5px;">${detailBtn} ${printBtn}</div></div>
                </div>`;
            });
        };
        if (window.globalRecentShifts && window.globalRecentShifts.length > 0) { renderShiftsHTML(window.globalRecentShifts); } 
        else { db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").getAll().onsuccess = (e) => { renderShiftsHTML(e.target.result.reverse()); }; }
    }
};

window.requestVoid = function(id, type) {
    if (!confirm("Apakah Anda yakin ingin membatalkan (VOID) data ini?")) return;
    db.transaction([type], "readonly").objectStore(type).get(id).onsuccess = (e) => {
        let rec = e.target.result; if(!rec) return alert("Data tidak ditemukan lokal.");
        if((type==='orders' && rec.orderStatus.includes("Void")) || (type==='expenses' && rec.status.includes("Void"))) return alert("Sudah dibatalkan.");
        db.transaction(["void_requests"], "readwrite").objectStore("void_requests").add({ id: id, type: type, timestamp: new Date().toISOString(), status: "Void Pending", authName: "Waiting Sync" });
        if(type==='orders') { rec.orderStatus = "Void Pending"; rec.syncStatus = "Pending"; } else { rec.status = "Void Pending"; rec.syncStatus = "Pending"; }
        db.transaction([type], "readwrite").objectStore(type).put(rec);
        alert("Permintaan Void dikirim. Sinkronisasi dengan server..."); window.renderHistoryList(type); window.runBackgroundSync();
    };
};

window.viewShiftDetails = function(shiftId) {
    if (window.globalRecentShifts) {
        let found = window.globalRecentShifts.find(s => s.shiftId === shiftId);
        if (found) { populateShiftModal(found, false); return; }
    }
    db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").get(shiftId).onsuccess = (e) => {
        if(e.target.result) populateShiftModal(e.target.result, false); else alert("Detail tidak ditemukan.");
    };
};
window.printShiftReportFromHistory = function(shiftId) {
    if (window.globalRecentShifts) { let found = window.globalRecentShifts.find(s => s.shiftId === shiftId); if (found && typeof window.buildShiftReportReceipt === "function") { window.buildShiftReportReceipt(found); return; } }
    db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").get(shiftId).onsuccess = (e) => { if(e.target.result && typeof window.buildShiftReportReceipt === "function") window.buildShiftReportReceipt(e.target.result); };
};
window.reprintOrder = function(orderId) {
    db.transaction(["orders"], "readonly").objectStore("orders").get(orderId).onsuccess = (e) => {
        let o = e.target.result; if(o && typeof window.buildEscPosReceipt === "function") window.buildEscPosReceipt(o.orderId, o, (o.cashAmount+o.qrisAmount+o.transferAmount+o.hotelPiutangAmount+o.tamuPiutangAmount), 0, o.paymentMethod, 0, 0);
    };
};

window.openShiftReport = function(historyData = null) {
    if (historyData) { populateShiftModal(historyData, false); } 
    else {
        if (!db || !currentShiftId) return alert("Anda belum membuka shift kasir.");
        let tx = db.transaction(["orders", "expenses", "coin_retrievals"], "readonly");
        let activeOrders = []; let activeExpenses = []; let activeCoinRets = [];
        
        tx.objectStore("orders").getAll().onsuccess = (ev) => { activeOrders = ev.target.result; };
        tx.objectStore("expenses").getAll().onsuccess = (ev) => { activeExpenses = ev.target.result; };
        tx.objectStore("coin_retrievals").getAll().onsuccess = (ev) => { activeCoinRets = ev.target.result; };

        tx.oncomplete = async () => {
            let shiftOrders = activeOrders.filter(o => o.shiftId === currentShiftId && o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending");
            let shiftExpenses = activeExpenses.filter(e => e.shiftId === currentShiftId && e.status === "Active");
            let loginTimeMs = new Date(currentLoginTime).getTime();
            let shiftCoinRets = activeCoinRets.filter(cr => cr.cashier === currentCashier && new Date(cr.timestamp).getTime() >= loginTimeMs);

            let tCust = 0; let tOrders = 0; let tOmset = 0; let tCash = 0; let tQris = 0; let tTransfer = 0;
            let hPiu = 0; let tPiu = 0; let tFree = 0; let tExpense = 0; let foodSummary = {};
            let tFreeItems = 0; let tDiscountNom = 0; let tCoinsUsed = 0; let tCoinsRecycled = 0; let tCoinsJammed = 0;
            let coinCategorySummary = {}; let categorySummary = {}; 

            const settings = await window.getDynamicSettings();
            let kesetPerBatch = Number(settings["Keset_Per_Batch"]) || 5; let bantalPerBatch = Number(settings["Sarung_Bantal_Per_Batch"]) || 10;
            let kgPerCuci = Number(settings["Kilo_Per_Koin_Cuci"]) || 5; let kgPerKering = Number(settings["Kilo_Per_Koin_Kering"]) || 5;

            shiftOrders.forEach(o => {
                tOrders++; if (o.customerPhone && o.customerPhone !== "-") tCust++;
                tOmset += o.grandTotal; tCash += (o.cashAmount || 0); tQris += (o.qrisAmount || 0); tTransfer += (o.transferAmount || 0);
                hPiu += (o.hotelPiutangAmount || 0); tPiu += (o.tamuPiutangAmount || 0); tFree += (o.freeAmount || 0);
                tDiscountNom += (o.discounts || 0);
                if (o.redeemedPromos && o.redeemedPromos.length > 0) o.redeemedPromos.forEach(rp => { tFreeItems += (rp.qty || 0); });

                let orderExpectedCoins = 0; let orderCoinBreakdown = {};

                if (o.items) {
                    o.items.forEach(i => { 
                        foodSummary[i.name] = (foodSummary[i.name] || 0) + i.qty; 
                        let cat = i.category || "Lainnya"; categorySummary[cat] = (categorySummary[cat] || 0) + (i.qty * i.originalPrice);

                        let name = String(i.name).toUpperCase(); let itemCoins = 0;
                        if (name.includes("KESET")) { itemCoins = Math.ceil(i.qty / kesetPerBatch) * 3; } 
                        else if (name.includes("BANTAL")) { itemCoins = Math.ceil(i.qty / bantalPerBatch) * 2; } 
                        else if (i.inputMode === "DECIMAL") { itemCoins = Math.ceil(i.qty / kgPerCuci) + Math.ceil(i.qty / kgPerKering); } 
                        else { let divisor = (i.hasMoq && i.moqQty > 0) ? i.moqQty : 1; let multiplier = Math.ceil(i.qty / divisor); itemCoins = (i.expectedCoins || 0) * multiplier; }

                        if (itemCoins > 0) { orderExpectedCoins += itemCoins; orderCoinBreakdown[cat] = (orderCoinBreakdown[cat] || 0) + itemCoins; }
                    });
                }
                
                let orderTotalCoins = (o.actualCoins !== undefined) ? o.actualCoins : (o.expectedCoins || orderExpectedCoins);
                tCoinsUsed += orderTotalCoins;
                
                for (let cat in orderCoinBreakdown) { coinCategorySummary[cat] = (coinCategorySummary[cat] || 0) + orderCoinBreakdown[cat]; }
                let diff = orderTotalCoins - orderExpectedCoins;
                if (diff !== 0) { coinCategorySummary["Penyesuaian Manual"] = (coinCategorySummary["Penyesuaian Manual"] || 0) + diff; }
            });
            
            shiftExpenses.forEach(exp => { tExpense += (exp.amount || 0); });
            shiftCoinRets.forEach(cr => { if (cr.notes && cr.notes.includes("Macet")) tCoinsJammed += cr.qty; else tCoinsRecycled += cr.qty; });

            let netCash = Math.max(0, tCash - tExpense);
            let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";

            window.currentShiftData = { 
                shiftId: currentShiftId, loginTime: currentLoginTime, logoutTime: new Date().toISOString(), cashier: currentCashier, 
                totalCustomers: tCust, totalOrders: tOrders, totalOmset: tOmset, totalCash: tCash, totalQris: tQris, totalTransfer: tTransfer, 
                totalHotelPiutang: hPiu, totalTamuPiutang: tPiu, totalFree: tFree, totalExpenses: tExpense, netCash: netCash, foodSummary: foodSummary,
                totalFreeItems: tFreeItems, totalDiscountNominal: tDiscountNom, totalCoinsUsed: tCoinsUsed, totalCoinsRecycled: tCoinsRecycled, totalCoinsJammed: tCoinsJammed,
                categorySummary: categorySummary, coinCategorySummary: coinCategorySummary, outlet: currentOutlet
            };
            populateShiftModal(window.currentShiftData, true);
        };
    }
};

function populateShiftModal(data, isActive) {
    let foodHtml = "";
    if (data.foodSummary) {
        for (const [name, qty] of Object.entries(data.foodSummary)) {
            let qtyStr = (qty % 1 !== 0) ? Number(qty).toFixed(2) : qty;
            foodHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #eee; padding:4px 0;"><span>${name}</span> <strong>${qtyStr}x</strong></div>`;
        }
    }
    
    let catHtml = "";
    if (data.coinCategorySummary) {
        for (const [cat, val] of Object.entries(data.coinCategorySummary)) {
            if (val !== 0) catHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #eee; padding:2px 0;"><span>${cat}</span> <strong style="color:#17a589;">${val.toFixed(1).replace('.0', '')} Koin</strong></div>`;
        }
    }
    if (document.getElementById("sd-categories")) document.getElementById("sd-categories").innerHTML = catHtml || "-";

    let outletDisplay = data.outlet ? ` (${data.outlet})` : "";
    if (document.getElementById("sd-id")) document.getElementById("sd-id").innerText = data.shiftId + outletDisplay;
    if (document.getElementById("sd-login")) document.getElementById("sd-login").innerText = formatWIB(data.loginTime);
    if (document.getElementById("sd-logout")) document.getElementById("sd-logout").innerText = isActive ? "Saat Ini" : formatWIB(data.logoutTime);
    if (document.getElementById("sd-cash")) document.getElementById("sd-cash").innerText = "Rp " + (data.totalCash || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-qris")) document.getElementById("sd-qris").innerText = "Rp " + (data.totalQris || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-hotel-piutang")) document.getElementById("sd-hotel-piutang").innerText = "Rp " + (data.totalHotelPiutang || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-tamu-piutang")) document.getElementById("sd-tamu-piutang").innerText = "Rp " + (data.totalTamuPiutang || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-expenses")) document.getElementById("sd-expenses").innerText = "Rp " + (data.totalExpenses || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-omset")) document.getElementById("sd-omset").innerText = "Rp " + (data.totalOmset || 0).toLocaleString('id-ID');
    
    if (document.getElementById("sd-net")) {
        document.getElementById("sd-net").innerText = "Rp " + (data.netCash || 0).toLocaleString('id-ID');
        document.getElementById("sd-net").parentElement.style.display = "flex"; 
    }
    
    if (document.getElementById("sd-free-items")) document.getElementById("sd-free-items").innerText = (data.totalFreeItems || 0) + " Item";
    if (document.getElementById("sd-discount-nom")) document.getElementById("sd-discount-nom").innerText = "Rp " + (data.totalDiscountNominal || 0).toLocaleString('id-ID');
    
    if (document.getElementById("sd-coins-used")) document.getElementById("sd-coins-used").innerText = (data.totalCoinsUsed || 0) + " Koin";
    if (document.getElementById("sd-coins-recycled")) document.getElementById("sd-coins-recycled").innerText = (data.totalCoinsRecycled || 0) + " Koin";
    if (document.getElementById("sd-coins-jammed")) document.getElementById("sd-coins-jammed").innerText = (data.totalCoinsJammed || 0) + " Koin";

    if (document.getElementById("sd-food")) document.getElementById("sd-food").innerHTML = foodHtml || "Belum ada item terjual";

    let mt = document.getElementById("meter-token"); if (mt) { mt.value = data.meterToken || 0; mt.readOnly = !isActive; mt.style.backgroundColor = isActive ? "#fff" : "#e9ecef"; }
    let mp = document.getElementById("meter-pasca"); if (mp) { mp.value = data.meterPasca || 0; mp.readOnly = !isActive; mp.style.backgroundColor = isActive ? "#fff" : "#e9ecef"; }

    let endBtn = document.getElementById("btn-end-shift-modal"); if (endBtn) { endBtn.style.display = isActive ? "block" : "none"; }
    let modal = document.getElementById("shift-detail-modal"); if (modal) modal.classList.remove("hidden");
}

window.printCurrentShiftReport = async function() {
    const data = window.currentShiftData; if (!data) return alert("Data ringkasan shift tidak tersedia untuk dicetak.");
    let mt = document.getElementById("meter-token"); data.meterToken = mt ? (parseFloat(mt.value) || 0) : (data.meterToken || 0);
    let mp = document.getElementById("meter-pasca"); data.meterPasca = mp ? (parseFloat(mp.value) || 0) : (data.meterPasca || 0);
    if (data.meterToken <= 0 && data.meterPasca <= 0) return alert("⚠️ Harap isi Meteran Listrik (Sisa Token atau Total Pasca) terlebih dahulu sebelum mencetak!");
    try {
        if (typeof window.buildShiftReportReceipt === "function") { await window.buildShiftReportReceipt(data); alert("Laporan penutupan shift berhasil dikirim ke printer!"); } 
        else { alert("⚠️ Modul printer belum terhubung. Silakan nyalakan bluetooth dan klik Printer di menu atas."); }
    } catch (e) { alert("Gagal mencetak laporan: " + e.toString()); }
};

window.triggerEndShift = async function() {
    const data = window.currentShiftData; if (!data) return alert("Gagal mengambil data shift kasir.");
    let diffMins = (new Date().getTime() - new Date(currentLoginTime).getTime()) / 60000;
    if (diffMins < 5 && data.totalOrders === 0 && data.totalOmset === 0) {
        if (confirm("Shift ini berjalan kurang dari 5 menit tanpa transaksi.\nApakah Anda ingin membatalkan dan menghapus shift ini tanpa dikirim ke server?")) {
            let tx = db.transaction(["active_shifts"], "readwrite"); tx.objectStore("active_shifts").delete(currentPin);
            tx.oncomplete = () => { window.location.reload(); }; return;
        }
    }
    let mt = document.getElementById("meter-token"); let meterT = mt ? (parseFloat(mt.value) || 0) : 0;
    let mp = document.getElementById("meter-pasca"); let meterP = mp ? (parseFloat(mp.value) || 0) : 0;
    if (meterT <= 0 && meterP <= 0) return alert("⚠️ Harap isi Meteran Listrik!");
    if (!confirm("Apakah Anda yakin ingin MENGAKHIRI SHIFT dan mengunci data keuangan Anda sekarang?\nLaporan penutupan akan langsung dikirim ke Cloud Google Sheet.")) return;
    if (btCharacteristic && typeof window.buildShiftReportReceipt === "function") {
        try { data.meterToken = meterT; data.meterPasca = meterP; await window.buildShiftReportReceipt(data); } catch (e) { console.error(e); }
    }
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const shiftPayload = {
        shiftId: currentShiftId, cashier: currentCashier, loginTime: currentLoginTime, logoutTime: new Date().toISOString(),
        totalCustomers: data.totalCustomers, totalOrders: data.totalOrders, totalOmset: data.totalOmset, totalCash: data.totalCash, totalQris: data.totalQris, totalTransfer: data.totalTransfer, totalHotelPiutang: data.totalHotelPiutang, totalTamuPiutang: data.totalTamuPiutang, totalFree: data.totalFree, totalExpenses: data.totalExpenses, netCash: data.netCash, foodSummary: data.foodSummary, totalCoinsUsed: data.totalCoinsUsed || 0, totalCoinsRecycled: data.totalCoinsRecycled || 0, totalCoinsJammed: data.totalCoinsJammed || 0, coinCategorySummary: data.coinCategorySummary || {}, meterToken: meterT, meterPasca: meterP, closeNote: "Manual Shift Closure by Cashier", outlet: currentOutlet, syncStatus: "Pending"
    };
    let tx = db.transaction(["local_shift_history", "shift_reports", "active_shifts"], "readwrite");
    tx.objectStore("local_shift_history").add(shiftPayload); tx.objectStore("shift_reports").add(shiftPayload);
    tx.objectStore("active_shifts").delete(currentPin);
    tx.oncomplete = async () => {
        let mod = document.getElementById("shift-detail-modal"); if(mod) mod.classList.add("hidden");
        alert("Shift Berhasil Ditutup! Memproses sinkronisasi cloud akhir...");
        await window.runBackgroundSync(); window.location.reload(); 
    };
};

function performAutoClose(shift) {
    let tx = db.transaction(["orders", "expenses"], "readonly");
    tx.objectStore("orders").getAll().onsuccess = (e) => {
        let vOrders = e.target.result.filter(o => o.shiftId === shift.shiftId && o.orderStatus !== "Voided");
        let tOmset = vOrders.reduce((s, o) => s + o.grandTotal, 0);
        let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
        const report = { shiftId: shift.shiftId, cashier: shift.cashierName, loginTime: shift.loginTime, logoutTime: new Date().toISOString(), totalCustomers: vOrders.length, totalOrders: vOrders.length, totalOmset: tOmset, totalCash: tOmset, totalQris: 0, totalTransfer: 0, totalHotelPiutang: 0, totalTamuPiutang: 0, totalFree: 0, totalExpenses: 0, netCash: tOmset, foodSummary: {}, closeNote: "System Auto-Closed (>4h Idle Expired)", outlet: currentOutlet, syncStatus: "Pending" };
        let txW = db.transaction(["local_shift_history", "shift_reports", "active_shifts"], "readwrite");
        txW.objectStore("local_shift_history").add(report); txW.objectStore("shift_reports").add(report);
        txW.objectStore("active_shifts").delete(shift.pin);
        if (shift.shiftId === currentShiftId) { alert("Shift kadaluarsa!"); window.location.reload(); }
    };
}

window.runBackgroundSync = async function() {
    if (!navigator.onLine || isSyncing) return; isSyncing = true; 
    try {
        let orders = await new Promise(res => db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = e => res(e.target.result));
        for (const order of orders) {
            if (order.syncStatus === "Pending") {
                try {
                    let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: "syncOrder", data: order }) });
                    if ((await r.json()).status === "Success") { order.syncStatus = "Synced"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); }
                } catch(e) {}
            }
        }
        let reports = await new Promise(res => db.transaction(["shift_reports"], "readonly").objectStore("shift_reports").getAll().onsuccess = e => res(e.target.result));
        for (const report of reports) {
            try {
                let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: "syncShiftReport", data: report }) });
                if ((await r.json()).status === "Success") db.transaction(["shift_reports"], "readwrite").objectStore("shift_reports").delete(report.shiftId);
            } catch(e) {}
        }
        let promoClaims = await new Promise(res => db.transaction(["promo_claims"], "readonly").objectStore("promo_claims").getAll().onsuccess = e => res(e.target.result));
        for (const claim of promoClaims) {
            try {
                let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: "syncPromoClaim", data: claim }) });
                if ((await r.json()).status === "Success") db.transaction(["promo_claims"], "readwrite").objectStore("promo_claims").delete(claim.claimId);
            } catch(e) {}
        }
        let expenses = await new Promise(res => db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = e => res(e.target.result));
        for (const exp of expenses) {
            if (exp.syncStatus === "Pending") {
                try {
                    let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: "syncExpense", data: exp }) });
                    if ((await r.json()).status === "Success") { exp.syncStatus = "Synced"; db.transaction(["expenses"], "readwrite").objectStore("expenses").put(exp); }
                } catch(e) {}
            }
        }
        let cashDrops = await new Promise(res => db.transaction(["cash_drops"], "readonly").objectStore("cash_drops").getAll().onsuccess = e => res(e.target.result));
        for (const drop of cashDrops) {
            try {
                let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: "syncCashDrop", data: drop }) });
                if ((await r.json()).status === "Success") db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").delete(drop.dropId);
            } catch(e) {}
        }
        let voids = await new Promise(res => db.transaction(["void_requests"], "readonly").objectStore("void_requests").getAll().onsuccess = e => res(e.target.result));
        for (const req of voids) {
            try {
                const actionType = req.type === 'orders' ? "requestOrderVoid" : "requestExpenseVoid"; const payload = req.type === 'orders' ? { orderId: req.id, status: req.status, authName: req.authName } : { expenseId: req.id, status: req.status, authName: req.authName };
                let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: actionType, ...payload }) });
                if ((await r.json()).status === "Success") db.transaction(["void_requests"], "readwrite").objectStore("void_requests").delete(req.id);
            } catch(e) {}
        }
        let members = await new Promise(res => db.transaction(["unsynced_members"], "readonly").objectStore("unsynced_members").getAll().onsuccess = e => res(e.target.result));
        for (const mem of members) {
            try {
                let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: "syncMember", data: mem }) });
                if ((await r.json()).status === "Success") db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").delete(mem.phone);
            } catch(e) {}
        }
        let coinRets = await new Promise(res => db.transaction(["coin_retrievals"], "readonly").objectStore("coin_retrievals").getAll().onsuccess = e => res(e.target.result));
        for (const cr of coinRets) {
            if (cr.syncStatus === "Pending") {
                try {
                    let actionCode = cr.notes && cr.notes.includes("Macet") ? "syncCoinJammed" : "syncCoinRetrieval";
                    let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: actionCode, data: cr }) });
                    if ((await r.json()).status === "Success") { cr.syncStatus = "Synced"; db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").put(cr); }
                } catch(e) {}
            }
        }
        let phoneUpds = await new Promise(res => db.transaction(["phone_updates"], "readonly").objectStore("phone_updates").getAll().onsuccess = e => res(e.target.result));
        for (const pu of phoneUpds) {
            try {
                let r = await fetch(API_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: "updateMemberPhone", data: pu }) });
                if ((await r.json()).status === "Success") db.transaction(["phone_updates"], "readwrite").objectStore("phone_updates").delete(pu.id);
            } catch(e) {}
        }
    } finally { isSyncing = false; }
};

window.onload = async () => { 
    await initDB(); 
    let loginBtn = document.getElementById("btn-login"); 
    if(loginBtn) loginBtn.innerText = "Menyiapkan...";
    await window.syncInitData(); 
    window.syncMasterData();     
    
    document.addEventListener("mousedown", function(e) {
        let resBox = document.getElementById('autocomplete-results');
        if (resBox && !e.target.closest('#autocomplete-results') && e.target.id !== 'cust-phone' && e.target.id !== 'cust-name') { 
            resBox.classList.add('hidden'); resBox.style.display = "none"; 
        }
    });

    window.setInterval(window.runBackgroundSync, 5000); 
    window.setInterval(window.syncMasterData, 30000); 
    function checkExpiredShifts() {
        if (!db) return;
        db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").getAll().onsuccess = (e) => {
            let activeShifts = e.target.result; let now = Date.now();
            activeShifts.forEach(shift => {
                let referenceTime = shift.lastActiveTime ? new Date(shift.lastActiveTime).getTime() : new Date(shift.loginTime).getTime();
                if (now - referenceTime > 4 * 60 * 60 * 1000) performAutoClose(shift);
            });
        };
    }
    window.setInterval(checkExpiredShifts, 60000); 
};

window.formatWIB = function(dateString) { if (!dateString) return "-"; const d = new Date(dateString); return d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
window.formatTimeOnlyWIB = function(dateString) { if (!dateString) return "-"; const d = new Date(dateString); return d.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }); };
