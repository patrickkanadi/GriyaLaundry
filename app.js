const API_URL = "https://script.google.com/macros/s/AKfycbxLfrUoCplYPUKJTbj_EUtXT2NDcU067bS8qHnapbC9g9Wr6CubXGrPJAtFKW2ti9Ts/exec";
const DB_NAME = "GriyaLaundry_POS";
const DB_VERSION = 34; 
let db;

let antreans = [
    { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null },
    { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null },
    { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null }
];
let currentAntreanIndex = 0;

let currentCashier = ""; let currentPin = ""; let currentShiftId = ""; let currentLoginTime = "";
let globalMenuData = []; let currentCategory = ""; let activeLaundryTickets = []; let currentCart = []; 
let activeNumpadItem = null; let numpadValue = "0"; let activeSettlementTicket = null;
window.masterDrawerBalance = 0; window.coinsInMachine = 0; let isLoggingOut = false; let currentVoidTarget = { type: null, id: null };
let isMenuLocked = true; let isSyncing = false; let activeCustomerProfile = null; let activeCoinPrice = 10000;
window.loyaltyTarget = 10; window.globalPromos = []; window.enableDrawerTracking = true;

let btDevice = null; let btCharacteristic = null; let printShiftOnLogout = false;
window.lastActivityWrite = Date.now();

// ==========================================
// 1. INISIALISASI DATABASE & PWA INSTALL
// ==========================================
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
            if (!db.objectStoreNames.contains("promo_claims")) db.createObjectStore("promo_claims", { keyPath: "claimId" });
            if (!db.objectStoreNames.contains("phone_updates")) db.createObjectStore("phone_updates", { keyPath: "id" });
        };
        request.onsuccess = (e) => { db = e.target.result; resolve(db); };
        request.onerror = (e) => { reject(e); };
    });
}

// LOGIKA PWA INSTALL
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e; 
    const installBtn = document.getElementById('btn-install'); if(installBtn) installBtn.classList.remove('hidden'); 
    const loginInstallBtn = document.getElementById('btn-install-login'); if(loginInstallBtn) loginInstallBtn.classList.remove('hidden');
});

window.installPWA = function() { 
    if (deferredPrompt) {
        deferredPrompt.prompt(); 
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                let btn = document.getElementById('btn-install'); if(btn) btn.classList.add('hidden');
                let loginBtn = document.getElementById('btn-install-login'); if(loginBtn) loginBtn.classList.add('hidden');
            }
            deferredPrompt = null; 
        }); 
    } 
};

function processVoidApprovals(authStatuses) {
    if (!db || !authStatuses) return;
    if (authStatuses.orders) {
        for (const [orderId, info] of Object.entries(authStatuses.orders)) {
            db.transaction(["orders"], "readonly").objectStore("orders").get(orderId).onsuccess = (e) => {
                let order = e.target.result;
                if (order && order.orderStatus !== info.status) { order.orderStatus = info.status; order.voidAuth = info.auth; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); }
            };
        }
    }
    if (authStatuses.expenses) {
        for (const [expenseId, info] of Object.entries(authStatuses.expenses)) {
            db.transaction(["expenses"], "readonly").objectStore("expenses").get(expenseId).onsuccess = (e) => {
                let expense = e.target.result;
                if (expense && expense.status !== info.status) { expense.status = info.status; db.transaction(["expenses"], "readwrite").objectStore("expenses").put(expense); }
            };
        }
    }
}

async function hashString(str) {
    const msgUint8 = new TextEncoder().encode(str); const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer)); return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatWIB(dateString) { return new Date(dateString).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') + ' WIB'; }
function formatTimeOnlyWIB(dateString) { return new Date(dateString).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' }) + ' WIB'; }

window.getDynamicSettings = function() {
    return new Promise((resolve) => {
        let settings = {};
        db.transaction(["settings"], "readonly").objectStore("settings").getAll().onsuccess = (e) => {
            if (e.target.result) { e.target.result.forEach(s => { settings[s.key] = s.value; }); }
            resolve(settings);
        };
    });
};

function logUserActivity() {
    let now = Date.now();
    if (currentPin && (now - window.lastActivityWrite > 5 * 60 * 1000)) {
        window.lastActivityWrite = now;
        let tx = db.transaction(["active_shifts"], "readwrite");
        tx.objectStore("active_shifts").get(currentPin).onsuccess = (e) => {
            let shift = e.target.result; if (shift) { shift.lastActiveTime = now; tx.objectStore("active_shifts").put(shift); }
        };
    }
}
['click', 'touchstart', 'keydown'].forEach(evt => window.addEventListener(evt, logUserActivity, { passive: true }));

// ==========================================
// 2. PRINTER ENGINE MURNI ESC/POS
// ==========================================
window.connectBluetoothPrinter = async function() {
    try {
        btDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x18F0] }], optionalServices: [0x18F0] });
        const server = await btDevice.gatt.connect(); const service = await server.getPrimaryService(0x18F0);
        btCharacteristic = await service.getCharacteristic(0x2AF1);
        const btn = document.getElementById("btn-printer"); if(btn) { btn.innerText = "🖨️ Printer: Terhubung"; btn.style.background = "#2ecc71"; }
    } catch (err) { alert("Gagal terhubung ke printer Bluetooth."); }
};

async function sendToPrinter(payloadUint8) {
    if (!btCharacteristic) { alert("Printer belum terhubung! Pastikan modul nyala dan terkoneksi di menu atas."); return; }
    const chunkSize = 20; 
    for (let i = 0; i < payloadUint8.length; i += chunkSize) {
        const chunk = payloadUint8.slice(i, i + chunkSize);
        await btCharacteristic.writeValue(chunk); await new Promise(r => setTimeout(r, 10)); 
    }
}

function formatEscPosLine(left, right, isBig) {
    const maxLen = isBig ? 16 : 32; const leftStr = String(left); const rightStr = String(right);
    const spaceNeeded = maxLen - (leftStr.length + rightStr.length);
    if (spaceNeeded > 0) return leftStr + " ".repeat(spaceNeeded) + rightStr;
    return leftStr + "\n" + " ".repeat(Math.max(0, maxLen - rightStr.length)) + rightStr;
}

window.buildEscPosReceipt = async function(orderId, order, deposit, remaining, payMethod, newPoints, newFree) {
    const settings = await window.getDynamicSettings();
    const h1 = settings["Header_1"] || "GRIYA LAUNDRY"; const h2 = settings["Header_2"] || ""; const h3 = settings["Header_3"] || ""; 
    const f1 = settings["Footer_1"] || "TERIMA KASIH"; const f2 = settings["Footer_2"] || ""; const f3 = settings["Footer_3"] || ""; const f4 = settings["Footer_4"] || ""; 
    
    const CMD_INIT = "\x1B\x40"; const CMD_CENTER = "\x1B\x61\x01"; const CMD_LEFT = "\x1B\x61\x00";
    const CMD_BOLD_ON = "\x1B\x45\x01"; const CMD_BOLD_OFF = "\x1B\x45\x00";
    const CMD_BIG = "\x1B!\x11"; const CMD_NORMAL = "\x1B!\x00"; const CMD_CUT = "\x1D\x56\x41\x10";

    let receipt = CMD_INIT;
    receipt += CMD_CENTER + CMD_BOLD_ON + CMD_BIG + h1 + "\n" + CMD_NORMAL + CMD_BOLD_OFF;
    if(h2) receipt += h2 + "\n";
    if(h3) receipt += h3 + "\n";
    
    receipt += "--------------------------------\n" + CMD_LEFT;
    receipt += "Nota: " + orderId + "\n";
    receipt += "Tgl : " + formatWIB(order.timestamp || new Date().toISOString()) + "\n";
    receipt += "Ksr : " + order.cashier + "\n";
    receipt += "Plgn: " + order.customerName + "\n";
    receipt += "--------------------------------\n";

    let remainingPromos = [...(order.redeemedPromos || []).map(p => ({...p}))];

    order.items.forEach(item => {
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        const priceDisplay = item.originalPrice.toLocaleString('id-ID');
        const lineTotal = (item.qty * item.originalPrice).toLocaleString('id-ID');
        
        receipt += CMD_BOLD_ON + item.name + CMD_BOLD_OFF + "\n";
        receipt += formatEscPosLine(`  ${qtyDisplay} x ${priceDisplay}`, lineTotal, false) + "\n";
        
        for (let i = 0; i < remainingPromos.length; i++) {
            let rp = remainingPromos[i];
            if (rp.qty > 0 && (rp.item === item.name || rp.item === item.subCategory || rp.item === item.category)) {
                let applyQty = Math.min(rp.qty, item.qty);
                if (applyQty > 0) {
                    let discountValue = applyQty * rp.price;
                    receipt += formatEscPosLine(`  >> Promo/Diskon`, "-" + discountValue.toLocaleString('id-ID'), false) + "\n";
                    rp.qty -= applyQty;
                }
            }
        }
    });

    receipt += "--------------------------------\n";
    receipt += formatEscPosLine("Subtotal", order.subtotal.toLocaleString('id-ID'), false) + "\n";
    if (order.discounts && order.discounts > 0) { receipt += formatEscPosLine("Total Diskon", "-" + order.discounts.toLocaleString('id-ID'), false) + "\n"; }
    receipt += "--------------------------------\n";
    receipt += CMD_BOLD_ON + CMD_BIG + formatEscPosLine("TOTAL", order.grandTotal.toLocaleString('id-ID'), true) + "\n" + CMD_NORMAL + CMD_BOLD_OFF + "\n";
    
    // --- BREAKDOWN PEMBAYARAN ---
    if (order.cashAmount > 0) receipt += formatEscPosLine(" - Tunai/Cash", order.cashAmount.toLocaleString('id-ID'), false) + "\n";
    if (order.qrisAmount > 0) receipt += formatEscPosLine(" - QRIS", order.qrisAmount.toLocaleString('id-ID'), false) + "\n";
    if (order.transferAmount > 0) receipt += formatEscPosLine(" - Transfer", order.transferAmount.toLocaleString('id-ID'), false) + "\n";
    if (order.freeAmount > 0) receipt += formatEscPosLine(" - Diskon/Promo", order.freeAmount.toLocaleString('id-ID'), false) + "\n";

    let piutangCount = (order.hotelPiutangAmount || 0) + (order.tamuPiutangAmount || 0);
    if (piutangCount > 0) { receipt += CMD_BOLD_ON + formatEscPosLine("SISA PIUTANG", piutangCount.toLocaleString('id-ID'), false) + "\n" + CMD_BOLD_OFF; } 
    else { receipt += CMD_BOLD_ON + formatEscPosLine("STATUS", "LUNAS", false) + "\n" + CMD_BOLD_OFF; }

    if (order.customerPhone && order.customerPhone !== "-" && order.customerPhone !== "Walk-in" && !order.customerPhone.startsWith("999")) {
        receipt += "--------------------------------\n" + CMD_CENTER + "-- INFO LOYALTY --\n" + CMD_LEFT;
        receipt += formatEscPosLine("Sisa Poin", newPoints + " / " + window.loyaltyTarget, false) + "\n";
        receipt += formatEscPosLine("Koin Gratis", newFree, false) + "\n";
    }

    receipt += "--------------------------------\n" + CMD_CENTER;
    receipt += CMD_BOLD_ON + f1 + "\n" + CMD_BOLD_OFF;
    receipt += "\x1B!\x01" + CMD_CENTER; 
    if(f2) receipt += f2 + "\n";
    if(f3) receipt += f3 + "\n";
    if(f4) receipt += f4 + "\n";
    receipt += CMD_NORMAL; receipt += "\n\n\n\n" + CMD_CUT;

    const encoder = new TextEncoder(); await sendToPrinter(encoder.encode(receipt));
};

window.buildShiftReportReceipt = async function(data) {
    const settings = await window.getDynamicSettings();
    const h1 = settings["Header_1"] || "GRIYA LAUNDRY";
    const CMD_INIT = "\x1B\x40"; const CMD_CENTER = "\x1B\x61\x01"; const CMD_LEFT = "\x1B\x61\x00"; const CMD_BOLD_ON = "\x1B\x45\x01"; const CMD_BOLD_OFF = "\x1B\x45\x00"; const CMD_BIG = "\x1B!\x11"; const CMD_NORMAL = "\x1B!\x00"; const CMD_CUT = "\x1D\x56\x41\x10";

    let r = CMD_INIT + CMD_CENTER + CMD_BOLD_ON + CMD_BIG + h1 + "\n" + CMD_NORMAL + CMD_BOLD_OFF;
    r += "LAPORAN TUTUP SHIFT\n--------------------------------\n" + CMD_LEFT;
    r += "ID Shift: " + data.shiftId + "\nKasir   : " + data.cashier + "\nLogin   : " + formatTimeOnlyWIB(data.loginTime) + "\nLogout  : " + formatTimeOnlyWIB(data.logoutTime) + "\n--------------------------------\n";
    r += formatEscPosLine("Total Nota", data.totalOrders, false) + "\n" + formatEscPosLine("Total Pelanggan", data.totalCustomers, false) + "\n--------------------------------\n";
    
    r += CMD_BOLD_ON + "PENERIMAAN KASIR & PIUTANG:" + CMD_BOLD_OFF + "\n";
    r += formatEscPosLine("Tunai / Cash", data.totalCash.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("QRIS", data.totalQris.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("Transfer Bank", data.totalTransfer.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("Piutang Hotel", data.totalHotelPiutang.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("Piutang Tamu", data.totalTamuPiutang.toLocaleString('id-ID'), false) + "\n";
    r += "--------------------------------\n";

    r += CMD_BOLD_ON + "PENGELUARAN:" + CMD_BOLD_OFF + "\n";
    r += formatEscPosLine("Pengeluaran Laci", data.totalExpenses.toLocaleString('id-ID'), false) + "\n";
    r += "--------------------------------\n";

    r += CMD_BOLD_ON + "STATISTIK KOIN FISIK:" + CMD_BOLD_OFF + "\n";
    r += formatEscPosLine("Total Terpakai", (data.totalCoinsUsed || 0) + " Koin", false) + "\n";
    if (data.coinCategorySummary) {
        for (const [cat, val] of Object.entries(data.coinCategorySummary)) {
            if (val > 0) r += formatEscPosLine(" - " + cat.substring(0, 15), val.toFixed(1).replace(".0","") + " Koin", false) + "\n";
        }
    }
    r += formatEscPosLine("Daur Ulang (Ambil)", (data.totalCoinsRecycled || 0) + " Koin", false) + "\n";
    r += formatEscPosLine("Macet/Rusak", (data.totalCoinsJammed || 0) + " Koin", false) + "\n";
    r += "--------------------------------\n";

    r += CMD_BOLD_ON + "STATISTIK PROMO:" + CMD_BOLD_OFF + "\n";
    r += formatEscPosLine("Item Gratis", (data.totalFreeItems || 0) + " Item", false) + "\n" + formatEscPosLine("Nominal Diskon", (data.totalDiscountNominal || 0).toLocaleString('id-ID'), false) + "\n--------------------------------\n";
    
    r += CMD_BOLD_ON + "RANGKUMAN AKHIR:" + CMD_BOLD_OFF + "\n" + formatEscPosLine("Omset Kotor", data.totalOmset.toLocaleString('id-ID'), false) + "\n\n";
    let laciTitle = window.enableDrawerTracking ? "SALDO LACI" : "SETOR ADMIN";
    r += CMD_BOLD_ON + formatEscPosLine(laciTitle, data.netCash.toLocaleString('id-ID'), false) + CMD_BOLD_OFF + "\n";
    
    if (data.foodSummary && Object.keys(data.foodSummary).length > 0) {
        r += "--------------------------------\n" + CMD_CENTER + "RINGKASAN ITEM TERJUAL\n" + CMD_LEFT;
        for (const [name, qty] of Object.entries(data.foodSummary)) {
            let qtyStr = (qty % 1 !== 0) ? Number(qty).toFixed(2) : String(qty);
            r += formatEscPosLine(qtyStr + "x " + name.substring(0,25), "", false) + "\n";
        }
    }
    r += "\n\n\n\n" + CMD_CUT;
    const encoder = new TextEncoder(); await sendToPrinter(encoder.encode(r));
};

// ==========================================
// 3. CORE LOGIN FAST SYNC
// ==========================================
window.attemptLogin = async function() {
    const pinInput = document.getElementById("cashier-pin");
    const rawPin = pinInput.value.trim(); 
    if (!rawPin) return; 
    let loginBtn = document.getElementById("btn-login"); 
    if(loginBtn) loginBtn.innerText = "Memverifikasi...";

    try {
        const hashedPin = await hashString(rawPin);
        let staff = await new Promise(res => db.transaction(["staff"], "readonly").objectStore("staff").get(hashedPin).onsuccess = e => res(e.target.result));
        
        if (!staff) { 
            if (navigator.onLine) { 
                if(loginBtn) loginBtn.innerText = "Menarik Data Baru...";
                await window.syncMasterData(true);
                let staffList = await new Promise(res => db.transaction(["staff"], "readonly").objectStore("staff").getAll().onsuccess = e => res(e.target.result));
                staff = staffList.find(s => s.pin === hashedPin);
            } 
        }

        if (staff) {
            // OUTLET VALIDATION CERDAS
            let allowedOutlets = staff.outlets ? staff.outlets.split(',').map(s=>s.trim()).filter(s=>s) : window.availableOutlets;
            let selectedOutlet = document.getElementById("outlet-select") ? document.getElementById("outlet-select").value : null;
            
            // Jika tidak memilih (atau tidak punya izin ke outlet yang dipilih), paksakan ke outlet default mereka
            if (!selectedOutlet || !allowedOutlets.includes(selectedOutlet)) {
                selectedOutlet = allowedOutlets.length > 0 ? allowedOutlets[0] : (window.availableOutlets.length > 0 ? window.availableOutlets[0] : "Pusat");
            }
            localStorage.setItem("selectedOutlet", selectedOutlet);
            window.currentOutlet = selectedOutlet;
            
            // FILTER MENU BERDASARKAN OUTLET
            window.globalMenuData = (window.globalMenuDataRaw || []).map(m => {
                let sJson = {}; try { sJson = JSON.parse(m.stockJson); } catch(e){}
                m.currentStock = Number(sJson[selectedOutlet]) || 0;
                return m;
            }).filter(m => {
                if (!m.outlets) return true;
                let outs = m.outlets.split(',').map(s=>s.trim().toLowerCase());
                if (outs.length === 0 || outs.includes("")) return true;
                return outs.includes(selectedOutlet.toLowerCase());
            });

            db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").get(hashedPin).onsuccess = (shiftReq) => {
                const activeShift = shiftReq.target.result;
                currentCashier = staff.name; currentPin = hashedPin;
                if (activeShift) { 
                    currentShiftId = activeShift.shiftId; currentLoginTime = activeShift.loginTime;
                } else { 
                    currentShiftId = "SHF-" + Date.now();
                    currentLoginTime = new Date().toISOString();
                    db.transaction(["active_shifts"], "readwrite").objectStore("active_shifts").put({pin: hashedPin, shiftId: currentShiftId, loginTime: currentLoginTime, lastActiveTime: Date.now(), cashierName: currentCashier});
                }
                
                let btnKoin = document.getElementById("btn-koin-top");
                if (btnKoin) btnKoin.innerHTML = `🪙 Laci: ${window.laciStocks ? (window.laciStocks[selectedOutlet] || 0) : 0} | Mesin: ${window.coinsInMachines ? (window.coinsInMachines[selectedOutlet] || 0) : 0}`;

                document.getElementById("login-screen").classList.add("hidden");
                document.getElementById("pos-screen").classList.remove("hidden");
                document.getElementById("display-cashier").innerText = currentCashier + ` (${selectedOutlet})`;
                
                window.switchWorkspace('new'); window.lockMenu();
                loadMenuUI();
            };
        } else {
            alert("PIN Kasir Salah atau Belum Terdaftar!");
        }
    } catch (err) {
        alert("Terjadi kesalahan sistem login.");
    } finally {
        pinInput.value = "";
        if(loginBtn) loginBtn.innerText = "Masuk / Buka Shift";
    }
};

window.switchWorkspace = function(type) {
    document.querySelectorAll('.ws-tab').forEach(b => b.classList.remove('active'));
    let mainWs = document.getElementById("main-workspace-wrapper");
    let ticketWs = document.getElementById("active-tickets-workspace");
    let piutangWs = document.getElementById("piutang-workspace");
    
    if(mainWs) mainWs.classList.add("hidden");
    if(ticketWs) ticketWs.classList.add("hidden");
    if(piutangWs) piutangWs.classList.add("hidden");

    if (type === 'new') {
        let tab = document.getElementById("tab-new-order"); if(tab) tab.classList.add("active");
        if(mainWs) mainWs.classList.remove("hidden");
    } else if (type === 'tickets') {
        let tab = document.getElementById("tab-active-tickets"); if(tab) tab.classList.add("active");
        if(ticketWs) ticketWs.classList.remove("hidden");
        window.renderActiveTickets(); 
    } else if (type === 'piutang') {
        let tab = document.getElementById("tab-piutang"); if(tab) tab.classList.add("active");
        if(piutangWs) piutangWs.classList.remove("hidden");
        window.renderPiutangTickets();
    }
};

window.lockScreen = function() { window.location.reload(); };

// ==========================================
// 4. ANTREAN, PELANGGAN & AUTOCOMPLETE (ANTI-BUG)
// ==========================================
window.switchAntrean = function(index) {
    if (currentAntreanIndex === index) return;
    antreans[currentAntreanIndex].cart = [...currentCart];
    antreans[currentAntreanIndex].profile = activeCustomerProfile ? {...activeCustomerProfile} : null;
    antreans[currentAntreanIndex].isLocked = isMenuLocked;
    
    let cp = document.getElementById("cust-phone"); if (cp) antreans[currentAntreanIndex].phoneInput = cp.value;
    let cn = document.getElementById("cust-name"); if (cn) antreans[currentAntreanIndex].nameInput = cn.value;
    
    currentAntreanIndex = index;
    currentCart = [...antreans[currentAntreanIndex].cart]; 
    activeCustomerProfile = antreans[currentAntreanIndex].profile ? {...antreans[currentAntreanIndex].profile} : null;
    isMenuLocked = antreans[currentAntreanIndex].isLocked;
    
    if (cp) cp.value = antreans[currentAntreanIndex].phoneInput;
    if (cn) cn.value = antreans[currentAntreanIndex].nameInput;

    document.querySelectorAll(".antrean-btn").forEach((btn, i) => {
        if (i === index) { btn.classList.add("active"); btn.style.background = "#fff"; btn.style.color = "#2980b9"; } 
        else { btn.classList.remove("active"); btn.style.background = "#bdc3c7"; btn.style.color = "#fff"; }
    });

    let cis = document.getElementById("customer-input-section");
    let acb = document.getElementById("active-customer-banner");
    let gl = document.getElementById("glass-overlay");
    let pi = document.getElementById("promo-indicator");

    if (isMenuLocked) {
        if (cis) cis.classList.remove("hidden");
        if (acb) acb.classList.add("hidden");
        if (gl) { gl.style.opacity = "1"; gl.style.pointerEvents = "auto"; }
        if (pi) pi.classList.add("hidden");
    } else {
        let pName = activeCustomerProfile ? activeCustomerProfile.name : ((cn ? cn.value : "") || "Walk-in");
        let pPhone = activeCustomerProfile ? activeCustomerProfile.phone : (cp ? cp.value : "");
        let acn = document.getElementById("active-cust-name"); if (acn) acn.innerText = pName;
        let acp = document.getElementById("active-cust-phone"); if (acp) acp.innerText = (pPhone && pPhone !== "-" && !pPhone.startsWith("999")) ? `(${pPhone})` : "";
        
        if (cis) cis.classList.add("hidden");
        if (acb) acb.classList.remove("hidden");
        if (gl) { gl.style.opacity = "0"; gl.style.pointerEvents = "none"; }
        
        let d = new Date(); let todayStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
        const lotteryBtn = document.getElementById("btn-trigger-lottery");
        if (lotteryBtn) {
            if (activeCustomerProfile && (activeCustomerProfile.lastClaimDate === todayStr || activeCustomerProfile.isNoWA)) {
                lotteryBtn.disabled = true; lotteryBtn.innerText = "🎫 Sudah Klaim Hari Ini";
            } else { lotteryBtn.disabled = false; lotteryBtn.innerText = "🎫 Pilih Undian"; }
        }
        window.updatePromoIndicator();
    }
    window.renderCart();
};

window.updatePromoIndicator = function() {
    let pi = document.getElementById("promo-indicator");
    if (!pi) return;
    if (!activeCustomerProfile) { pi.classList.add("hidden"); return; }
    let promoText = `🎁 ${activeCustomerProfile.freeCoins || 0} Koin Gratis! (Poin: ${activeCustomerProfile.points || 0}/${window.loyaltyTarget})`;
    let storedCount = Object.values(activeCustomerProfile.storedRewards || {}).reduce((a,b)=>a+b,0);
    if (storedCount > 0) promoText += ` | <span style="cursor:pointer; text-decoration:underline; color:purple;" onclick="window.showStoredRewards()">🎫 ${storedCount} Undian Tersimpan</span>`;
    
    let pending = antreans[currentAntreanIndex].pendingPromoCode;
    if (pending) promoText += ` | ⏳ Menunggu Checkout: ${pending}`;
    
    pi.innerHTML = promoText;
    pi.classList.remove("hidden");
};

window.showStoredRewards = function() {
    if(!activeCustomerProfile || !activeCustomerProfile.storedRewards) return;
    let items = Object.entries(activeCustomerProfile.storedRewards).filter(([k,v]) => v > 0);
    if(items.length === 0) return alert("Tidak ada hadiah tersimpan.");
    let msg = "🎁 Hadiah Undian Tersimpan:\n\n"; items.forEach(([k,v]) => msg += `- ${v}x ${k}\n`); alert(msg);
};

window.openLotteryModal = function() {
    if (!activeCustomerProfile) return alert("Harap pilih profil pelanggan terlebih dahulu.");
    if (activeCustomerProfile.isNoWA) { return alert("⚠️ Pelanggan tanpa WhatsApp valid tidak dapat didaftarkan dalam program undian."); } 
    const select = document.getElementById("lottery-select");
    if(select) { 
        select.innerHTML = '-- Pilih Promo Undian --';
        let currentOutlet = window.currentOutlet || "Pusat";
        window.globalPromos.forEach(p => { 
            let usedInOutlet = p.usedQuotaJson ? (p.usedQuotaJson[currentOutlet] || 0) : 0;
            // Cek kuota KHUSUS per Outlet
            if(p.weeklyQuota === 0 || usedInOutlet < p.weeklyQuota) { 
                select.innerHTML += `<option value="${p.code}">${p.code} (${p.rewardItem})</option>`; 
            } 
        });
    } 
    let desc = document.getElementById("lottery-desc"); if(desc) desc.innerHTML = ""; 
    let mod = document.getElementById("lottery-modal"); if(mod) mod.classList.remove("hidden"); 
};

window.updateLotteryDesc = function() {
    let sel = document.getElementById("lottery-select"); if(!sel) return;
    let code = sel.value; let descDiv = document.getElementById("lottery-desc");
    if(!code) { if(descDiv) descDiv.innerHTML = ""; return; }
    let promo = window.globalPromos.find(p => p.code === code);
    if(promo && descDiv) { descDiv.innerHTML = `<div style="padding:10px; background:#e8f4f8; border-radius:6px; color:#2980b9; font-weight:bold; margin-bottom:15px; text-align:left;">🎁 <strong>Insentif:</strong> Mendapatkan ${promo.rewardQty}x ${promo.rewardItem}</div>`; }
};

window.submitLotteryCode = async function() {
    if (!activeCustomerProfile) return alert("Pilih pelanggan terlebih dahulu!");
    let sel = document.getElementById("lottery-select"); if(!sel) return;
    let code = sel.value; if (!code) return alert("Silakan pilih salah satu promo dari kotak dropdown!");

    let d = new Date(); let todayStr = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0') + "-" + String(d.getDate()).padStart(2,'0');
    let hasPending = await new Promise(resolve => {
        db.transaction(["promo_claims"], "readonly").objectStore("promo_claims").getAll().onsuccess = e => {
            let claims = e.target.result; let found = claims.some(c => c.phone === activeCustomerProfile.phone && String(c.timestamp).startsWith(todayStr));
            resolve(found);
        };
    });

    if (activeCustomerProfile.lastClaimDate === todayStr || hasPending) {
        let mod = document.getElementById("lottery-modal"); if(mod) mod.classList.add("hidden");
        return alert("⚠️ Pelanggan ini sudah mengklaim undian hari ini. (Batas maksimal 1 klaim per hari)");
    }

    let promo = window.globalPromos.find(p => p.code === code); if (!promo) return alert("Promo tidak valid.");
    antreans[currentAntreanIndex].pendingPromoCode = code;
    let mod = document.getElementById("lottery-modal"); if(mod) mod.classList.add("hidden");
    window.updatePromoIndicator();
};

window.lockMenu = function() {
    isMenuLocked = true; activeCustomerProfile = null; 
    let promoContainer = document.getElementById("review-promo-section");
    if (promoContainer) promoContainer.innerHTML = "";
    
    let pf = document.getElementById("pay-free");
    if (pf) { if(pf.tagName === 'INPUT') pf.value = 0; else pf.innerText = 0; }

    let cis = document.getElementById("customer-input-section"); if(cis) cis.classList.remove("hidden");
    let acb = document.getElementById("active-customer-banner"); if(acb) acb.classList.add("hidden");
    let gl = document.getElementById("glass-overlay"); if(gl) { gl.style.opacity = "1"; gl.style.pointerEvents = "auto"; }
    
    let cp = document.getElementById("cust-phone"); if(cp) cp.value = ""; 
    let cn = document.getElementById("cust-name"); if(cn) cn.value = "";
    
    currentCart = []; 
    antreans[currentAntreanIndex] = { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null };
    window.renderCart();
    let pi = document.getElementById("promo-indicator"); if(pi) pi.classList.add("hidden");
};

function proceedToUnlock(phone, name) {
    let acn = document.getElementById("active-cust-name"); if(acn) acn.innerText = name; 
    let acp = document.getElementById("active-cust-phone"); if(acp) acp.innerText = (phone !== "-" && !phone.startsWith("999")) ? `(${phone})` : "";
    let cis = document.getElementById("customer-input-section"); if(cis) cis.classList.add("hidden");
    let acb = document.getElementById("active-customer-banner"); if(acb) acb.classList.remove("hidden");
    isMenuLocked = false; 
    let gl = document.getElementById("glass-overlay"); 
    if(gl) { gl.style.opacity = "0"; setTimeout(() => { gl.style.pointerEvents = "none"; }, 300); }

    antreans[currentAntreanIndex].isLocked = false; 
    antreans[currentAntreanIndex].phoneInput = phone; antreans[currentAntreanIndex].nameInput = name; 
    antreans[currentAntreanIndex].profile = activeCustomerProfile ? {...activeCustomerProfile} : null;
    
    let d = new Date(); let todayStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    const lotteryBtn = document.getElementById("btn-trigger-lottery");
    if (lotteryBtn) {
        if (activeCustomerProfile && (activeCustomerProfile.lastClaimDate === todayStr || activeCustomerProfile.isNoWA)) {
            lotteryBtn.disabled = true; lotteryBtn.innerText = "🎫 Sudah Klaim Hari Ini";
        } else { lotteryBtn.disabled = false; lotteryBtn.innerText = "🎫 Pilih Undian"; }
    }

    window.updatePromoIndicator(); window.renderCart();
}

window.unlockMenu = function(isGuest) {
    let phone = "-"; let name = "Walk-in";
    let cp = document.getElementById("cust-phone");
    let cn = document.getElementById("cust-name");

    if (isGuest) { 
        if(cp) cp.value = ""; if(cn) cn.value = "Walk-in"; activeCustomerProfile = null; 
        proceedToUnlock(phone, name);
    } else { 
        phone = cp ? cp.value.trim() : ""; name = (cn ? cn.value.trim() : "") || "Pelanggan"; 
        if (phone.length < 5) {
            if (confirm("Daftarkan pelanggan tanpa nomor WhatsApp?")) {
                phone = "999" + Date.now().toString().slice(-7);
                if(cp) cp.value = phone;
                if (cn && !cn.value.trim()) cn.value = "Pelanggan Tanpa WA";
                proceedToUnlock(phone, name);
            } else { return; }
        } else {
            db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (e) => {
                activeCustomerProfile = e.target.result;
                if(!activeCustomerProfile) {
                    activeCustomerProfile = { phone: phone, name: name, points: 0, freeCoins: 0, spent: 0, storedRewards: {} };
                    alert(`✅ Member baru berhasil ditambahkan!\nNama: ${name}\nWA: ${phone}`);
                }
                proceedToUnlock(phone, name);
            };
        }
    }
};

window.selectMember = function(phone) {
    db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (e) => {
        activeCustomerProfile = e.target.result;
        if(activeCustomerProfile) {
            let cp = document.getElementById("cust-phone"); if(cp) cp.value = activeCustomerProfile.phone;
            let cn = document.getElementById("cust-name"); if(cn) cn.value = activeCustomerProfile.name;
            let rb = document.getElementById("autocomplete-results"); if(rb) { rb.classList.add("hidden"); rb.style.display = "none"; }
            window.updatePromoIndicator();
        }
    };
};

window.handleAutocomplete = function(e) {
    if(!db) return;
    const val = e.target ? e.target.value.toLowerCase().trim() : ""; 
    const resBox = document.getElementById("autocomplete-results");
    if (!resBox) return;
    
    if (activeCustomerProfile) {
        if (val !== activeCustomerProfile.phone.toLowerCase() && val !== activeCustomerProfile.name.toLowerCase()) {
            activeCustomerProfile = null; 
            let pi = document.getElementById("promo-indicator"); if(pi) pi.classList.add("hidden");
        }
    } else {
        let pi = document.getElementById("promo-indicator"); if(pi) pi.classList.add("hidden");
    }
    
    db.transaction(["members"], "readonly").objectStore("members").getAll().onsuccess = (ev) => {
        let matches = ev.target.result; 
        if (val.length > 0) {
            matches = matches.filter(m => String(m.phone).toLowerCase().includes(val) || String(m.name).toLowerCase().includes(val));
        }
        
        matches.sort((a, b) => (b.spent || 0) - (a.spent || 0));

        if (val.length === 0) {
            matches = matches.slice(0, 15);
        }

        if (matches.length > 0) {
            resBox.innerHTML = matches.map(m => `
                <div class="autocomplete-item" onmousedown="window.selectMember('${m.phone}')" style="padding: 12px 15px; border-bottom: 1px solid #eef2f3; cursor: pointer; text-align: left; background: #fff; font-size: 15px; z-index: 10000; position:relative;">
                    <div style="font-weight: bold; color: #2980b9;">${m.phone}</div>
                    <div style="font-size: 13px; color: #555; margin-top:2px;">${m.name}</div>
                </div>
            `).join("");
            resBox.classList.remove("hidden");
            resBox.style.display = "block";
        } else { 
            resBox.classList.add("hidden"); resBox.style.display = "none"; 
        }
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
    let eop = document.getElementById("edit-old-phone"); let oldPhone = eop ? eop.value.trim() : ""; 
    let enp = document.getElementById("edit-new-phone"); let newPhone = enp ? enp.value.trim() : "";
    let enn = document.getElementById("edit-new-name"); let newName = enn ? enn.value.trim() : "";
    
    if(!oldPhone || !newPhone) return alert("Nomor tidak boleh kosong.");

    db.transaction(["members"], "readonly").objectStore("members").get(oldPhone).onsuccess = (e) => {
        let member = e.target.result; if (!member) return alert("Nomor lama tidak ditemukan.");
        db.transaction(["phone_updates"], "readwrite").objectStore("phone_updates").add({ id: "UPD-" + Date.now(), oldPhone: oldPhone, newPhone: newPhone, newName: newName, syncStatus: "Pending" });
        
        member.phone = newPhone;
        if (newName) member.name = newName;
        
        let tx = db.transaction(["members"], "readwrite");
        tx.objectStore("members").delete(oldPhone); tx.objectStore("members").put(member);
        alert("Data Member berhasil diubah!"); window.lockMenu(); 
        let mod = document.getElementById("edit-member-modal"); if(mod) mod.classList.add("hidden");
        window.runBackgroundSync();
    };
};

// ==========================================
// 5. MENU & NUMPAD & TRANSAKSI (CART)
// ==========================================
function loadMenuUI() {
    if (!globalMenuData || globalMenuData.length === 0) {
        db.transaction(["menu"], "readonly").objectStore("menu").getAll().onsuccess = (e) => {
            globalMenuData = e.target.result || [];
            if(globalMenuData.length > 0) loadMenuUI(); 
        };
        return;
    }

    const categories = [...new Set(globalMenuData.map(i => i.category))]; currentCategory = categories[0];
    const catContainer = document.getElementById("category-container"); if(!catContainer) return;
    catContainer.innerHTML = "";
    categories.forEach(cat => {
        const btn = document.createElement("button"); btn.className = `cat-btn ${cat === currentCategory ? "active" : ""}`; btn.innerText = cat;
        btn.onclick = () => { currentCategory = cat; document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active")); btn.classList.add("active"); renderProductGrid(); };
        catContainer.appendChild(btn);
    });
    renderProductGrid();
}

function renderProductGrid() {
    const grid = document.getElementById("product-grid"); if(!grid) return;
    grid.innerHTML = "";
    globalMenuData.filter(i => i.category === currentCategory).forEach(item => {
        const card = document.createElement("div"); card.className = "product-card";
        
        let stockHtml = "";
        if (item.trackStock) {
            let stockColor = item.currentStock <= 5 ? "color: #e74c3c;" : "color: #27ae60;";
            stockHtml = `<div style="font-size: 11px; font-weight: bold; margin-top: 5px; ${stockColor}">Sisa Stok: ${item.currentStock}</div>`;
        }
        
        card.innerHTML = `<div><h4>${item.name}</h4>${stockHtml}</div><div class="price-badge">Rp ${item.price.toLocaleString('id-ID')}</div>`;
        card.onclick = () => { 
            if(!isMenuLocked) { 
                if(item.inputMode === "DECIMAL") window.openNumpad(item); 
                else window.addToCart(item, 1); 
            } 
        };
        grid.appendChild(card);
    });
}

window.openNumpad = function(item) { activeNumpadItem = item; numpadValue = "0"; let nd = document.getElementById("numpad-display"); if(nd) nd.innerText = "0"; let mod = document.getElementById("numpad-modal"); if(mod) mod.classList.remove("hidden"); };
window.closeNumpad = function() { let mod = document.getElementById("numpad-modal"); if(mod) mod.classList.add("hidden"); activeNumpadItem = null; };
window.numpadPress = function(val) {
    if (val === 'DEL') { numpadValue = numpadValue.slice(0, -1) || "0"; } else if (val === '.') { if (!numpadValue.includes('.')) numpadValue += '.'; } else { numpadValue = numpadValue === "0" ? String(val) : numpadValue + val; }
    let nd = document.getElementById("numpad-display"); if(nd) nd.innerText = numpadValue;
};
window.confirmNumpad = function() { let qty = parseFloat(numpadValue); if (qty > 0) window.addToCart(activeNumpadItem, qty); window.closeNumpad(); };

window.addToCart = function(item, qty) {
    let finalQty = qty; const existing = currentCart.find(i => i.itemId === item.itemId);
    let currentQtyInCart = existing ? existing.qty : 0;
    
    if (item.trackStock) {
        if (currentQtyInCart + finalQty > item.currentStock) {
            alert(`⚠️ Stok tidak cukup!\nSisa stok ${item.name} hanya tinggal ${item.currentStock}.`);
            finalQty = item.currentStock - currentQtyInCart;
            if (finalQty <= 0) return; 
        }
    }
    
    if (!existing && item.hasMoq && item.moqQty > 0 && finalQty < item.moqQty) { 
        alert(`⚠️ Minimum Order (MOQ) untuk ${item.name} adalah ${item.moqQty}.\nJumlah otomatis disesuaikan.`); 
        finalQty = item.moqQty; 
        if (item.trackStock && (currentQtyInCart + finalQty > item.currentStock)) {
             alert(`⚠️ Stok tidak cukup untuk memenuhi minimum order!`);
             return;
        }
    }
    
    if (existing) { existing.qty += finalQty; } 
    else { currentCart.push({ ...item, qty: finalQty, originalPrice: item.price, expectedCoins: item.expectedCoins, hasMoq: item.hasMoq, moqQty: item.moqQty }); }
    window.renderCart();
};

window.updateCartItemQty = function(itemId, delta) {
    let existing = currentCart.find(i => i.itemId === itemId);
    if (existing) {
        if (delta > 0 && existing.trackStock) {
            if (existing.qty + delta > existing.currentStock) {
                return alert(`⚠️ Maksimal stok ${existing.name} hanya ${existing.currentStock}!`);
            }
        }
        
        existing.qty += delta;
        if (existing.hasMoq && existing.moqQty > 0) { 
            if (existing.qty > 0 && existing.qty < existing.moqQty) { 
                if (delta < 0) existing.qty = 0; else existing.qty = existing.moqQty; 
            } 
        }
        if (existing.qty <= 0) currentCart = currentCart.filter(i => i.itemId !== itemId);
        window.renderCart();
    }
};

window.renderCart = function() {
    const container = document.getElementById("cart-items"); if(!container) return;
    container.innerHTML = ""; let total = 0;
    currentCart.forEach(item => {
        const lineTotal = item.qty * item.price; total += lineTotal; 
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        container.innerHTML += `
        <div class="cart-item" style="display:flex; justify-content:space-between; align-items:center; padding:15px 0; border-bottom:1px solid #edf2f7; gap: 10px;">
            <div style="flex: 1;"><strong style="font-size: 16px; color: #2c3e50;">${item.name}</strong><br><small style="font-size: 13px; color: #7f8c8d;">Rp ${item.price.toLocaleString('id-ID')} x ${qtyDisplay}</small></div>
            <div style="display:flex; align-items:center; gap:12px; background: #f8f9fa; padding: 4px; border-radius: 8px; border: 1px solid #e2e8f0;">
                <button onclick="window.updateCartItemQty('${item.itemId}', -1)" style="background:#e74c3c; color:white; border:none; width:45px; height:45px; border-radius:6px; font-weight:bold; font-size:22px; cursor:pointer; display:flex; align-items:center; justify-content:center;">-</button>
                <span style="font-size: 18px; font-weight: bold; min-width: 30px; text-align: center;">${qtyDisplay}</span>
                <button onclick="window.updateCartItemQty('${item.itemId}', 1)" style="background:#2ecc71; color:white; border:none; width:45px; height:45px; border-radius:6px; font-weight:bold; font-size:22px; cursor:pointer; display:flex; align-items:center; justify-content:center;">+</button>
            </div>
        </div>`;
    });
    let totalContainer = document.getElementById("cart-grand-total") || document.getElementById("cart-total");
    if (totalContainer) totalContainer.innerText = `Rp ${total.toLocaleString('id-ID')}`;
    window.cartSubtotal = total; window.cartGrandTotal = total;
};

window.openReview = function() {
    if (currentCart.length === 0) return alert("Keranjang masih kosong!");
    
    let inputs = ["pay-cash", "pay-qris", "pay-transfer", "pay-hotel-piutang", "pay-tamu-piutang"];
    inputs.forEach(id => { let el = document.getElementById(id); if(el && el.tagName === 'INPUT') el.value = 0; });
    let pf = document.getElementById("pay-free"); if(pf) { if(pf.tagName === 'INPUT') pf.value = 0; else pf.innerText = 0; }
    
    window.cartSubtotal = currentCart.reduce((sum, item) => sum + (item.qty * item.price), 0);
    window.cartGrandTotal = window.cartSubtotal;
    
    let promoHtml = "";
    if (activeCustomerProfile) {
        let cartCoins = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
        let maxRedeemable = 0; let F = activeCustomerProfile.freeCoins || 0; let P = activeCustomerProfile.points || 0; let T = window.loyaltyTarget || 10;

        for (let r = cartCoins; r >= 0; r--) {
            let paidItems = cartCoins - r;
            let earnedFree = Math.floor((P + paidItems) / T);
            if (r <= F + earnedFree) { maxRedeemable = r; break; }
        }

        if (maxRedeemable > 0) {
            promoHtml += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; background:#fef9e7; padding:8px; border-radius:6px; border:1px solid #f9e79f;">
               <div><strong style="color:#856404; font-size:12px;">🎁 Koin Gratis (Loyalty)</strong><br><small style="color:#7d6608; font-size:11px;">Maks klaim: ${maxRedeemable}</small></div>
               <input type="number" class="promo-input" data-type="loyalty" data-item="Koin_Fisik" data-price="${activeCoinPrice}" value="0" max="${maxRedeemable}" min="0" oninput="window.applyPromo()" style="width:60px; padding:4px; font-weight:bold; text-align:center; border:1px solid #d4ac0d; border-radius:4px; font-size:14px;">
           </div>`;
        }

        if (activeCustomerProfile.storedRewards) {
            for (const [rewardName, qtyOwned] of Object.entries(activeCustomerProfile.storedRewards)) {
                if (qtyOwned > 0) {
                    let cartItem = currentCart.find(i => i.name === rewardName || i.subCategory === rewardName || i.category === rewardName);
                    if (cartItem) {
                        let possibleClaim = Math.min(qtyOwned, Math.floor(cartItem.qty));
                        if (possibleClaim > 0) {
                            promoHtml += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; background:#f9ebff; padding:8px; border-radius:6px; border:1px solid #d6b4fc;">
                               <div><strong style="color:#8e44ad; font-size:12px;">🎫 Undian: ${rewardName}</strong><br><small style="color:#6c3483; font-size:11px;">Maks guna: ${possibleClaim}</small></div>
                               <input type="number" class="promo-input" data-type="stored" data-item="${rewardName}" data-price="${cartItem.originalPrice}" value="0" max="${possibleClaim}" min="0" oninput="window.applyPromo()" style="width:60px; padding:4px; font-weight:bold; text-align:center; border:1px solid #9b59b6; border-radius:4px; font-size:14px;">
                           </div>`;
                        }
                    }
                }
            }
        }
    }

    let promoContainer = document.getElementById("review-promo-section");
    if (promoContainer) {
        promoContainer.innerHTML = promoHtml;
        if (promoHtml) promoContainer.classList.remove("hidden");
        else promoContainer.classList.add("hidden");
    }
 
    let rst = document.getElementById("review-subtotal"); if(rst) rst.innerText = `Rp ${window.cartSubtotal.toLocaleString('id-ID')}`;
    let rgt = document.getElementById("review-grandtotal"); if(rgt) rgt.innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    window.applyPromo();
    
    let mod = document.getElementById("review-modal"); if(mod) mod.classList.remove("hidden");
};
window.reviewOrder = window.openReview;

window.closeReview = function() {
    let reviewModal = document.getElementById("review-modal");
    if (reviewModal) { reviewModal.classList.add("hidden"); }
};
window.closeReviewModal = window.closeReview;
window.cancelOrder = window.closeReview;

window.applyPromo = function() {
    let totalFreeValue = 0;
    document.querySelectorAll('.promo-input').forEach(input => {
        let max = Number(input.max) || 0; let val = Number(input.value) || 0;
        if (val > max) { val = max; input.value = val; }
        if (val < 0) { val = 0; input.value = 0; }
        totalFreeValue += (val * (Number(input.getAttribute('data-price')) || 0));
    });
 
    let pf = document.getElementById("pay-free");
    if (pf) { if (pf.tagName === 'INPUT') pf.value = totalFreeValue; else pf.innerText = totalFreeValue; }
    
    window.cartGrandTotal = Math.max(0, window.cartSubtotal - totalFreeValue);
    let rgt = document.getElementById("review-grandtotal");
    if(rgt) rgt.innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    
    window.calculateRemaining(false);
};

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

window.clearCart = function(force = false) { 
    if (currentCart.length === 0 && !force) return alert("Keranjang sudah kosong!");
    if (!force && !confirm("Apakah Anda yakin ingin membatalkan order (mengosongkan keranjang)?")) return;
    currentCart = []; window.renderCart();
    let pf = document.getElementById("pay-free"); 
    if(pf) { if(pf.tagName === 'INPUT') pf.value = 0; else pf.innerText = 0; }
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
        actualCoins: isLaundry ? 0 : expectedCoinsTotal, // FIX Instant: Langsung set aktual
        outlet: currentOutlet, syncStatus: "Pending" 
    };

    let tx = db.transaction(["orders"], "readwrite");
    tx.objectStore("orders").add(orderPayload);
    
    tx.oncomplete = async () => {
        if (finalStatus === "Processing" || hotelPiutang > 0 || tamuPiutang > 0) {
            window.activeLaundryTickets.push(orderPayload);
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
    if(!profile.phone || profile.phone === "-") return;
    db.transaction(["members"], "readwrite").objectStore("members").put(profile);
    db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").put(profile);
};

// ==========================================
// 6. TIKET AKTIF & CUCIAN BERJALAN
// ==========================================
window.renderActiveTickets = function() {
    const grid = document.getElementById("ticket-grid-container"); if(!grid) return;
    grid.innerHTML = "";
    let tickets = activeLaundryTickets.filter(t => t.orderStatus === "Processing" || t.orderStatus === "Ready for Pickup");
    if(tickets.length === 0) return grid.innerHTML = "<p>Tidak ada cucian aktif.</p>";
    
    tickets.forEach((ticket) => {
        const isReady = ticket.orderStatus === "Ready for Pickup";
        let receiptText = ticket.readableReceipt || (ticket.items ? ticket.items.map(i => `${i.qty % 1 !== 0 ? i.qty.toFixed(2) : i.qty}x ${i.name}`).join('\n') : "");
        let expectedWashing = ticket.washingCoins || 0; // Hanya ambil asumsi cuci
        
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
    let elExpected = document.getElementById("done-expected-coins"); if (elExpected) elExpected.innerText = expectedWashing; // Tampilkan khusus koin cuci
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
        ticket.actualCoins = actualWashingInput + instantC; // Aktual Total = Aktual Cuci + Jual/Instant
        
        if (actualWashingInput !== expectedWashing) { ticket.coinDiscrepancy = true; } 
        
        ticket.syncStatus = "Pending";
        db.transaction(["orders"], "readwrite").objectStore("orders").put(ticket);
        window.renderActiveTickets(); window.runBackgroundSync();
    }
    document.getElementById("ticket-done-modal").classList.add("hidden");
};

window.openSettlement = function(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    
    if (remainingDue <= 0) {
        if(confirm("Cucian ini sudah LUNAS. Tandai sudah diambil pelanggan?")) {
            activeSettlementTicket.orderStatus = "Completed"; 
            activeSettlementTicket.syncStatus = "Pending";
            db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
            activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
            window.renderActiveTickets(); 
            window.runBackgroundSync();
            activeSettlementTicket = null;
        }
        return;
    }

    let elAmt = document.getElementById("settle-amount"); if(elAmt) elAmt.innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    let elCash = document.getElementById("settle-cash"); if(elCash) elCash.value = remainingDue;
    let elQris = document.getElementById("settle-qris"); if(elQris) elQris.value = 0;
    let elTrf = document.getElementById("settle-transfer"); if(elTrf) elTrf.value = 0;
    document.getElementById("settlement-modal").classList.remove("hidden");
};

window.confirmSettlement = function() {
    if (!activeSettlementTicket) return;
    const c = Number(document.getElementById("settle-cash").value) || 0; const q = Number(document.getElementById("settle-qris").value) || 0; const t = Number(document.getElementById("settle-transfer").value) || 0;
    activeSettlementTicket.cashAmount += c; activeSettlementTicket.qrisAmount += q; activeSettlementTicket.transferAmount += t;
    activeSettlementTicket.orderStatus = "Completed"; activeSettlementTicket.syncStatus = "Pending";
    db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
    activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
    document.getElementById("settlement-modal").classList.add("hidden"); window.renderActiveTickets(); window.runBackgroundSync();
};

window.openPiutangPayment = function(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    document.getElementById("piutang-settle-amount").innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    document.getElementById("piutang-settle-cash").value = remainingDue;
    document.getElementById("piutang-settle-qris").value = 0;
    document.getElementById("piutang-settle-transfer").value = 0;
    document.getElementById("piutang-payment-modal").classList.remove("hidden");
};

window.confirmPiutangPayment = function() {
    if (!activeSettlementTicket) return;
    const c = Number(document.getElementById("piutang-settle-cash").value) || 0; 
    const q = Number(document.getElementById("piutang-settle-qris").value) || 0; 
    const t = Number(document.getElementById("piutang-settle-transfer").value) || 0;
    
    activeSettlementTicket.cashAmount = (activeSettlementTicket.cashAmount || 0) + c; 
    activeSettlementTicket.qrisAmount = (activeSettlementTicket.qrisAmount || 0) + q; 
    activeSettlementTicket.transferAmount = (activeSettlementTicket.transferAmount || 0) + t;
    
    activeSettlementTicket.hotelPiutangAmount = 0;
    activeSettlementTicket.tamuPiutangAmount = 0;
    activeSettlementTicket.orderStatus = "Completed"; 
    activeSettlementTicket.piutangPaidDate = new Date().toISOString(); 
    activeSettlementTicket.syncStatus = "Pending";
    
    db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
    activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
    
    document.getElementById("piutang-payment-modal").classList.add("hidden"); 
    window.renderPiutangTickets(); window.runBackgroundSync();
};

// ==========================================
// 7. OPERASIONAL PENGELUARAN LACI
// ==========================================
window.openExpenseModal = function() { 
    document.getElementById("expense-modal").classList.remove("hidden"); 
    const list = document.getElementById("expense-category-list");
    if(list && window.expenseCategories) { 
        list.innerHTML = ""; 
        window.expenseCategories.forEach(cat => { 
            const opt = document.createElement("option"); opt.value = cat; list.appendChild(opt); 
        }); 
    } 
};

window.saveExpense = function() { 
    const amount = Number(document.getElementById("exp-amount").value); 
    const category = document.getElementById("exp-category").value.trim();
    if (amount <= 0 || !category) return alert("Harap masukkan jumlah dan kategori yang benar."); 
    db.transaction(["expense_categories"], "readwrite").objectStore("expense_categories").put({ name: category });
    
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { expenseId: "EXP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, category: category, description: document.getElementById("exp-desc").value || "-", amount: amount, status: "Active", outlet: currentOutlet, syncStatus: "Pending" }; 
    db.transaction(["expenses"], "readwrite").objectStore("expenses").add(payload); 
    document.getElementById("expense-modal").classList.add("hidden"); 
    document.getElementById("exp-amount").value = ""; document.getElementById("exp-category").value = ""; document.getElementById("exp-desc").value = ""; 
    alert("Pengeluaran Berhasil Dicatat!"); window.runBackgroundSync(); 
};

// ==========================================
// 8. MODUL RINGKASAN HISTORI & VOID TRANSAKSI
// ==========================================
window.openHistoryModal = function() {
    document.getElementById("history-modal").classList.remove("hidden");
    window.renderHistoryList('orders');
};

window.renderHistoryList = function(type) {
    const container = document.getElementById("history-container"); if(!container) return;
    container.innerHTML = "";
    if (type === 'orders') {
        db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
            const shiftOrders = e.target.result.filter(o => o.shiftId === currentShiftId).reverse();
            if(shiftOrders.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada order di shift ini.</div>`;
            shiftOrders.forEach(o => {
                let badge = o.orderStatus === "Voided" ? `<span class="status-badge status-voided">Dibatalkan</span>` : o.orderStatus === "Void Pending" ? `<span class="status-badge status-pending">Menunggu Admin</span>` : `<span class="status-badge status-paid">${o.orderStatus}</span>`;
                let btn = (o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending") ? `<button onclick="window.requestVoid('orders', '${o.orderId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;" title="Batalkan Transaksi">Batal</button>` : '';
                let printBtn = `<button onclick="window.reprintOrder('${o.orderId}')" style="background:#3498db; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">🖨️</button>`;
                let detailBtn = `<button onclick="window.viewOrderDetails('${o.orderId}')" style="background:#f39c12; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">👁️ Detail</button>`;
                container.innerHTML += `<div class="history-row"><div><strong>${o.customerName}</strong><br><small style="color:#7f8c8d;">${formatTimeOnlyWIB(o.timestamp)} | Rp ${o.grandTotal.toLocaleString('id-ID')}</small></div><div style="display:flex; align-items:center; gap:8px;">${badge} ${detailBtn} ${printBtn} ${btn}</div></div>`;
            });
        };
    } else if (type === 'expenses') {
        db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = (e) => {
            const shiftExpenses = e.target.result.filter(exp => exp.shiftId === currentShiftId).reverse();
            if(shiftExpenses.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada pengeluaran dicatat.</div>`;
            shiftExpenses.forEach(exp => {
                let badge = exp.status === "Voided" ? `<span class="status-badge status-voided">Dibatalkan</span>` : exp.status === "Void Pending" ? `<span class="status-badge status-pending">Menunggu Admin</span>` : `<span class="status-badge status-paid">Aktif</span>`;
                let btn = (exp.status !== "Voided" && exp.status !== "Void Pending") ? `<button onclick="window.requestVoid('expenses', '${exp.expenseId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Batal</button>` : '';
                container.innerHTML += `<div class="history-row"><div><strong>${exp.category}</strong><br><small style="color:#7f8c8d;">${formatTimeOnlyWIB(exp.timestamp)} | Rp ${exp.amount.toLocaleString('id-ID')}</small><br><small>${exp.description}</small></div><div style="display:flex; align-items:center; gap:10px;">${badge} ${btn}</div></div>`;
            });
        };
    } else if (type === 'aruskas') {
        Promise.all([
            new Promise(res => db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = e => res(e.target.result)),
            new Promise(res => db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = e => res(e.target.result))
        ]).then(([orders, expenses]) => {
            let shiftOrders = orders.filter(o => o.shiftId === currentShiftId && o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending");
            let shiftExpenses = expenses.filter(e => e.shiftId === currentShiftId && e.status === "Active");
            let combined = [];
            shiftOrders.forEach(o => {
                let totalIn = (o.cashAmount || 0) + (o.qrisAmount || 0) + (o.transferAmount || 0);
                if (totalIn > 0) { combined.push({ type: 'in', time: new Date(o.timestamp), desc: `Nota: ${o.orderId}`, amount: totalIn }); }
            });
            shiftExpenses.forEach(e => {
                combined.push({ type: 'out', time: new Date(e.timestamp), desc: `Pengeluaran: ${e.category}`, amount: e.amount });
            });
            combined.sort((a, b) => b.time - a.time);
            if(combined.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada arus kas tunai di shift ini.</div>`;
            combined.forEach(log => {
                let color = log.type === 'in' ? '#27ae60' : '#e74c3c';
                let sign = log.type === 'in' ? '+' : '-';
                container.innerHTML += `<div class="history-row"><div><strong>${log.desc}</strong><br><small style="color:#7f8c8d;">${formatTimeOnlyWIB(log.time.toISOString())}</small></div><div style="font-weight:bold; font-size:16px; color:${color};">${sign}Rp ${log.amount.toLocaleString('id-ID')}</div></div>`;
            });
        });
    } else if (type === 'shifts') {
        const renderShiftsHTML = (shiftsData) => {
            const filtered = shiftsData.filter(s => s.cashier === currentCashier).slice(0, 6);
            if(filtered.length === 0) { container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada histori shift Anda di sistem.</div>`; return; }
            filtered.forEach(s => {
                let detailBtn = `<button onclick="window.viewShiftDetails('${s.shiftId}')" style="background:#f39c12; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">👁️ Detail</button>`;
                let printBtn = `<button onclick="window.printShiftReportFromHistory('${s.shiftId}')" style="background:#3498db; color:white; border:none; padding:6px 10px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:11px;">🖨️ Cetak</button>`;
                let itemsStr = "Tidak ada item";
                if (s.foodSummary && Object.keys(s.foodSummary).length > 0) itemsStr = Object.entries(s.foodSummary).map(([k,v]) => `${v}x ${k}`).join(', ');

                container.innerHTML += `
                <div class="history-row" style="align-items:flex-start; display:flex; gap:10px;">
                    <div style="flex:2;">
                        <strong>Shift: ${s.shiftId}</strong><br>
                        <small style="color:#7f8c8d;">Keluar: ${formatWIB(s.logoutTime)}</small><br>
                        <small style="color:#2980b9; display:block; margin-top:4px; line-height:1.4;">📦 <strong>Item:</strong> ${itemsStr}</small>
                    </div>
                    <div style="flex:1; text-align:right;">
                        <strong style="color:#27ae60; display:block; margin-bottom:6px; font-size:14px;">Rp ${(s.totalOmset || 0).toLocaleString('id-ID')}</strong>
                        <div style="display:flex; justify-content:flex-end; gap:5px;">${detailBtn} ${printBtn}</div>
                    </div>
                </div>`;
            });
        };
        if (window.globalRecentShifts && window.globalRecentShifts.length > 0) { renderShiftsHTML(window.globalRecentShifts); } 
        else { db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").getAll().onsuccess = (e) => { renderShiftsHTML(e.target.result.reverse()); }; }
    }
};

window.viewOrderDetails = function(orderId) {
    db.transaction(["orders"], "readonly").objectStore("orders").get(orderId).onsuccess = (e) => {
        let order = e.target.result; if(!order) return alert("Order tidak ditemukan.");
        let itemsHtml = ""; let remainingPromos = [...(order.redeemedPromos || []).map(p => ({...p}))];
        order.items.forEach(item => {
            let lineTotal = item.qty * item.originalPrice;
            itemsHtml += `<div style="display:flex; justify-content:space-between; margin-top:8px;"><div style="font-weight:bold;">${item.qty}x ${item.name}</div><div style="font-weight:bold;">Rp ${lineTotal.toLocaleString('id-ID')}</div></div>`;
        });
        document.getElementById("detail-items").innerHTML = itemsHtml;
        document.getElementById("detail-subtotal").innerText = `Rp ${(order.subtotal || 0).toLocaleString('id-ID')}`;
        document.getElementById("detail-discount").innerText = `-Rp ${(order.discounts || 0).toLocaleString('id-ID')}`;
        document.getElementById("detail-grandtotal").innerText = `Rp ${(order.grandTotal || 0).toLocaleString('id-ID')}`;
        document.getElementById("detail-paymethod").innerText = order.paymentMethod || "-";
        document.getElementById("order-detail-modal").classList.remove("hidden");
    };
};

window.reprintOrder = async function(orderId) { 
    if (!btCharacteristic) return alert("Printer belum terhubung! Silakan hubungkan dari menu atas.");
    db.transaction(["orders"], "readonly").objectStore("orders").get(orderId).onsuccess = async (e) => {
        const order = e.target.result;
        if (!order) return alert("Data order tidak ditemukan di memori lokal.");
        const deposit = (order.cashAmount || 0) + (order.qrisAmount || 0) + (order.transferAmount || 0) + (order.freeAmount || 0) + (order.hotelPiutangAmount || 0) + (order.tamuPiutangAmount || 0);
        if (order.customerPhone && order.customerPhone !== "-" && order.customerPhone !== "Walk-in" && !order.customerPhone.startsWith("999")) {
            db.transaction(["members"], "readonly").objectStore("members").get(order.customerPhone).onsuccess = async (me) => {
                let mem = me.target.result; let pts = mem ? mem.points : 0; let fre = mem ? mem.freeCoins : 0;
                if (typeof window.buildEscPosReceipt === "function") await window.buildEscPosReceipt(order.orderId + " (COPY)", order, deposit, 0, order.paymentMethod, pts, fre);
            };
        } else { if (typeof window.buildEscPosReceipt === "function") await window.buildEscPosReceipt(order.orderId + " (COPY)", order, deposit, 0, order.paymentMethod, 0, 0); }
    };
};

window.printShiftReportFromHistory = async function(shiftId) { 
    if (!btCharacteristic) return alert("Printer belum terhubung! Silakan hubungkan dari menu atas.");
    const onlineShift = (window.globalRecentShifts || []).find(s => s.shiftId === shiftId);
    if (onlineShift) {
        if (typeof window.buildShiftReportReceipt === "function") await window.buildShiftReportReceipt(onlineShift);
    } else {
        db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").get(shiftId).onsuccess = async (e) => {
            let shiftData = e.target.result;
            if (!shiftData) return alert("Data laporan shift ini tidak ditemukan di memori lokal tablet ini.");
            if (typeof window.buildShiftReportReceipt === "function") await window.buildShiftReportReceipt(shiftData);
        };
    }
};

window.viewShiftDetails = function(shiftId) { 
    const onlineShift = (window.globalRecentShifts || []).find(s => s.shiftId === shiftId);
    if (onlineShift) {
        window.currentShiftData = onlineShift; 
        window.openShiftReport(onlineShift); 
    } else {
        db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").get(shiftId).onsuccess = (e) => {
            let s = e.target.result; if (!s) return alert("Data riwayat shift tidak ditemukan.");
            window.currentShiftData = s;
            window.openShiftReport(s);
        };
    }
};

window.requestVoid = function(type, id) {
    currentVoidTarget = { type: type, id: id };
    document.getElementById("void-auth-name").value = ""; document.getElementById("void-auth-pin").value = "";
    document.getElementById("void-auth-modal").classList.remove("hidden");
};

// ==========================================
// 9. MANAGEMENT KOIN & SETORAN TUNAI
// ==========================================
window.openCashDrop = function() {
    document.getElementById("cashdrop-modal").classList.remove("hidden");
};

window.submitCashDrop = function() { 
    const admin = Number(document.getElementById("drop-admin").value) || 0; 
    const bank = Number(document.getElementById("drop-bank").value) || 0; 
    const drawer = Number(document.getElementById("drop-drawer").value) || 0;
    if (admin === 0 && bank === 0) return alert("Masukkan nominal setor uang."); 
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { dropId: "DRP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, toAdmin: admin, toBank: bank, leftInDrawer: drawer, notes: document.getElementById("drop-notes").value || "-", outlet: currentOutlet, syncStatus: "Pending" };
    db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").add(payload);
    document.getElementById("cashdrop-modal").classList.add("hidden");
    document.getElementById("drop-admin").value = ""; document.getElementById("drop-bank").value = ""; document.getElementById("drop-drawer").value = ""; document.getElementById("drop-notes").value = "";
    alert("Setoran berhasil dicatat!"); window.runBackgroundSync(); 
};

window.openCoinManagement = function() {
    document.getElementById("coin-management-modal").classList.remove("hidden");
};

window.submitCoinManagement = function() {
    const actionType = document.getElementById("coin-action-type").value;
    const qty = Number(document.getElementById("manage-coin-qty").value);
    let note = document.getElementById("manage-coin-note").value.trim();

    if (qty <= 0) return alert("Jumlah koin tidak valid.");

    let prefix = actionType === "jammed" ? "JAM-" : "RET-";
    if (!note) { note = actionType === "jammed" ? "Mesin Macet / Tertelan" : "Daur Ulang Koin Fisik"; }

    const payload = { retrievalId: prefix + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, qty: qty, notes: note, syncStatus: "Pending" };
    db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload);
    
    document.getElementById("manage-coin-qty").value = ""; document.getElementById("manage-coin-note").value = "";
    document.getElementById("coin-management-modal").classList.add("hidden");
    
    alert("Laporan koin berhasil dicatat!"); window.runBackgroundSync();
};

window.saveCoinRetrieval = function() { 
    const qty = Number(document.getElementById("coin-retrieval-qty").value); 
    if (qty <= 0) return alert("Jumlah koin tidak valid.");
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { retrievalId: "RET-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, qty: qty, notes: "Daur Ulang Koin Fisik", outlet: currentOutlet, syncStatus: "Pending" };
    db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload); 
    document.getElementById("coin-retrieval-qty").value = ""; alert("Pengambilan koin tercatat (Menunggu Approval)"); window.runBackgroundSync(); 
};

window.saveCoinJammed = function() { 
    const qty = Number(document.getElementById("coin-jammed-qty").value); 
    if (qty <= 0) return alert("Jumlah koin tidak valid.");
    let currentOutlet = localStorage.getItem("selectedOutlet") || "Pusat";
    const payload = { retrievalId: "JAM-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, qty: qty, notes: "Mesin Macet / Tertelan", outlet: currentOutlet, syncStatus: "Pending" };
    db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload); 
    document.getElementById("coin-jammed-qty").value = ""; alert("Koin macet tercatat!"); window.runBackgroundSync(); 
};

// ==========================================
// 10. SINKRONISASI INTI (FAST PIN SYNC)
// ==========================================
window.syncMasterData = async function(isSilent = false) {
    let nTxt = document.getElementById("network-text");
    let nDot = document.getElementById("network-dot");
    if (!navigator.onLine) { 
        if(nTxt) nTxt.innerText = "Mode Offline"; 
        if(nDot) nDot.style.backgroundColor = "#e74c3c"; 
        return;
    }
    try {
        const response = await fetch(API_URL, { method: 'GET', mode: 'cors' });
        const result = await response.json();
        
        if (result.status === "Success") {
            window.masterDrawerBalance = result.masterDrawerBalance || 0;
            window.loyaltyTarget = result.data.loyaltyTarget || 10; 
            window.globalPromos = result.data.promos || [];
            window.globalRecentShifts = result.recentShifts || [];
            window.expenseCategories = result.data.expenseCategories || [];
            
            window.enableDrawerTracking = String(result.data.settings["Enable_Drawer_Tracking"]).toUpperCase() !== "FALSE";
            document.querySelectorAll("button[onclick*='openCashDrop'], #btn-drawer, #btn-cashdrop").forEach(btn => {
                if(btn) btn.style.display = window.enableDrawerTracking ? "" : "none";
            });

            window.availableOutlets = (result.data.settings["Available_Outlets"] || "Pusat").split(",").map(s => s.trim());
            window.laciStocks = result.laciStock || {};
            window.coinsInMachines = result.coinsInMachine || {};
            
            let outletSel = document.getElementById("outlet-select");
            if (outletSel) {
                let savedOutlet = localStorage.getItem("selectedOutlet");
                outletSel.innerHTML = "";
                window.availableOutlets.forEach(out => {
                    let opt = document.createElement("option");
                    opt.value = out; opt.innerText = out;
                    if (out === savedOutlet) opt.selected = true;
                    outletSel.appendChild(opt);
                });
                outletSel.onchange = (e) => localStorage.setItem("selectedOutlet", e.target.value);
            }

            if (result.data.staff) {
                let txStaff = db.transaction(["staff"], "readwrite");
                result.data.staff.forEach(s => txStaff.objectStore("staff").put(s));
            }
            if (result.data.menu) {
                window.globalMenuDataRaw = result.data.menu;
                let txMenu = db.transaction(["menu"], "readwrite");
                result.data.menu.forEach(m => txMenu.objectStore("menu").put(m));
            }
            if (result.data.members) {
                let txMem = db.transaction(["members"], "readwrite");
                result.data.members.forEach(m => txMem.objectStore("members").put(m));
            }

            let txOthers = db.transaction(["unsynced_members"], "readonly");
            txOthers.objectStore("unsynced_members").getAll().onsuccess = (e) => {
                let unsynced = e.target.result;
                if (unsynced.length > 0) {
                    let txPut = db.transaction(["members"], "readwrite");
                    unsynced.forEach(m => txPut.objectStore("members").put(m));
                }
                
                activeLaundryTickets = result.data.activeLaundryOrders || [];
                let tCount = activeLaundryTickets.filter(t => t.orderStatus === "Processing" || t.orderStatus === "Ready for Pickup").length;
                let pCount = activeLaundryTickets.filter(t => t.hotelPiutangAmount > 0 || t.tamuPiutangAmount > 0).length;
                
                let tc = document.getElementById("ticket-count"); if(tc) tc.innerText = tCount;
                let pc = document.getElementById("piutang-count"); if(pc) pc.innerText = pCount;
                
                if (!document.getElementById("pos-screen").classList.contains("hidden")) { 
                    window.renderActiveTickets(); window.renderPiutangTickets(); 
                }
                if (result.data.authStatuses) processVoidApprovals(result.data.authStatuses);
            };
        }
    } catch (error) {}
};

window.manualPushSync = async function() {
    if (!navigator.onLine) return alert("Anda sedang offline!");
    let nTxt = document.getElementById("network-text"); let nDot = document.getElementById("network-dot");
    if(nTxt) nTxt.innerText = "Mengirim Data..."; if(nDot) nDot.style.backgroundColor = "#f39c12";
    let lTxt = document.getElementById("login-network-text"); let lDot = document.getElementById("login-network-dot");
    if(lTxt) lTxt.innerText = "Mendorong Data Lokal..."; if(lDot) lDot.style.backgroundColor = "#f39c12";

    await window.runBackgroundSync();
    if(nTxt) nTxt.innerText = "Menarik Data..."; if(lTxt) lTxt.innerText = "Sinkronisasi Server...";
    await window.syncMasterData(); alert("Sinkronisasi Database Berhasil!");
};

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

// ==========================================
// 11. SHIFT REPORT & PENUTUPAN (AKHIRI SHIFT)
// ==========================================
window.openShiftReport = function(historyData = null) {
    if (historyData) {
        populateShiftModal(historyData, false);
    } else {
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
            
            let tFreeItems = 0; let tDiscountNom = 0;
            let tCoinsUsed = 0; let tCoinsRecycled = 0; let tCoinsJammed = 0;
            let coinCategorySummary = {}; 
            let categorySummary = {}; 

            const settings = await window.getDynamicSettings();
            let kesetPerBatch = Number(settings["Keset_Per_Batch"]) || 5; 
            let bantalPerBatch = Number(settings["Sarung_Bantal_Per_Batch"]) || 10;
            let kgPerCuci = Number(settings["Kilo_Per_Koin_Cuci"]) || 5;
            let kgPerKering = Number(settings["Kilo_Per_Koin_Kering"]) || 5;

            shiftOrders.forEach(o => {
                tOrders++; if (o.customerPhone && o.customerPhone !== "-") tCust++;
                tOmset += o.grandTotal; tCash += (o.cashAmount || 0); tQris += (o.qrisAmount || 0); tTransfer += (o.transferAmount || 0);
                hPiu += (o.hotelPiutangAmount || 0); tPiu += (o.tamuPiutangAmount || 0); tFree += (o.freeAmount || 0);
                
                tDiscountNom += (o.discounts || 0);
                if (o.redeemedPromos && o.redeemedPromos.length > 0) o.redeemedPromos.forEach(rp => { tFreeItems += (rp.qty || 0); });

                let orderExpectedCoins = 0;
                let orderCoinBreakdown = {};

                if (o.items) {
                    o.items.forEach(i => { 
                        foodSummary[i.name] = (foodSummary[i.name] || 0) + i.qty; 
                        let cat = i.category || "Lainnya";
                        categorySummary[cat] = (categorySummary[cat] || 0) + (i.qty * i.originalPrice);

                        let name = String(i.name).toUpperCase();
                        let itemCoins = 0;

                        if (name.includes("KESET")) {
                            itemCoins = Math.ceil(i.qty / kesetPerBatch) * 3;
                        } else if (name.includes("BANTAL")) {
                            itemCoins = Math.ceil(i.qty / bantalPerBatch) * 2;
                        } else if (i.inputMode === "DECIMAL") {
                            itemCoins = Math.ceil(i.qty / kgPerCuci) + Math.ceil(i.qty / kgPerKering);
                        } else {
                            let divisor = (i.hasMoq && i.moqQty > 0) ? i.moqQty : 1;
                            let multiplier = Math.ceil(i.qty / divisor);
                            itemCoins = (i.expectedCoins || 0) * multiplier;
                        }

                        if (itemCoins > 0) {
                            orderExpectedCoins += itemCoins;
                            orderCoinBreakdown[cat] = (orderCoinBreakdown[cat] || 0) + itemCoins;
                        }
                    });
                }
                
                let orderTotalCoins = (o.actualCoins !== undefined) ? o.actualCoins : (o.expectedCoins || orderExpectedCoins);
                tCoinsUsed += orderTotalCoins;
                
                for (let cat in orderCoinBreakdown) {
                    coinCategorySummary[cat] = (coinCategorySummary[cat] || 0) + orderCoinBreakdown[cat];
                }
                
                let diff = orderTotalCoins - orderExpectedCoins;
                if (diff !== 0) {
                    coinCategorySummary["Penyesuaian Manual"] = (coinCategorySummary["Penyesuaian Manual"] || 0) + diff;
                }
            });
            
            shiftExpenses.forEach(exp => { tExpense += (exp.amount || 0); });
            
            shiftCoinRets.forEach(cr => {
                if (cr.notes && cr.notes.includes("Macet")) tCoinsJammed += cr.qty;
                else tCoinsRecycled += cr.qty;
            });

            let netCash = Math.max(0, tCash - tExpense);

            window.currentShiftData = { 
                shiftId: currentShiftId, loginTime: currentLoginTime, logoutTime: new Date().toISOString(), cashier: currentCashier, 
                totalCustomers: tCust, totalOrders: tOrders, totalOmset: tOmset, totalCash: tCash, totalQris: tQris, totalTransfer: tTransfer, 
                totalHotelPiutang: hPiu, totalTamuPiutang: tPiu, totalFree: tFree, totalExpenses: tExpense, netCash: netCash, foodSummary: foodSummary,
                totalFreeItems: tFreeItems, totalDiscountNominal: tDiscountNom,
                totalCoinsUsed: tCoinsUsed, totalCoinsRecycled: tCoinsRecycled, totalCoinsJammed: tCoinsJammed,
                categorySummary: categorySummary,
                coinCategorySummary: coinCategorySummary
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
    if (document.getElementById("sd-transfer")) document.getElementById("sd-transfer").innerText = "Rp " + (data.totalTransfer || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-hotel-piutang")) document.getElementById("sd-hotel-piutang").innerText = "Rp " + (data.totalHotelPiutang || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-tamu-piutang")) document.getElementById("sd-tamu-piutang").innerText = "Rp " + (data.totalTamuPiutang || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-expenses")) document.getElementById("sd-expenses").innerText = "Rp " + (data.totalExpenses || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-omset")) document.getElementById("sd-omset").innerText = "Rp " + (data.totalOmset || 0).toLocaleString('id-ID');
    
    if (document.getElementById("sd-net")) {
        document.getElementById("sd-net").innerText = "Rp " + (data.netCash || 0).toLocaleString('id-ID');
        document.getElementById("sd-net").parentElement.style.display = window.enableDrawerTracking ? "flex" : "none";
    }
    
    if (document.getElementById("sd-free-items")) document.getElementById("sd-free-items").innerText = (data.totalFreeItems || 0) + " Item";
    if (document.getElementById("sd-discount-nom")) document.getElementById("sd-discount-nom").innerText = "Rp " + (data.totalDiscountNominal || 0).toLocaleString('id-ID');
    
    if (document.getElementById("sd-coins-used")) document.getElementById("sd-coins-used").innerText = (data.totalCoinsUsed || 0) + " Koin";
    if (document.getElementById("sd-coins-recycled")) document.getElementById("sd-coins-recycled").innerText = (data.totalCoinsRecycled || 0) + " Koin";
    if (document.getElementById("sd-coins-jammed")) document.getElementById("sd-coins-jammed").innerText = (data.totalCoinsJammed || 0) + " Koin";

    if (document.getElementById("sd-food")) document.getElementById("sd-food").innerHTML = foodHtml || "Belum ada item terjual";

    let mt = document.getElementById("meter-token");
    if (mt) { mt.value = data.meterToken || 0; mt.readOnly = !isActive; mt.style.backgroundColor = isActive ? "#fff" : "#e9ecef"; }
    let mp = document.getElementById("meter-pasca");
    if (mp) { mp.value = data.meterPasca || 0; mp.readOnly = !isActive; mp.style.backgroundColor = isActive ? "#fff" : "#e9ecef"; }

    let endBtn = document.getElementById("btn-end-shift-modal");
    if (endBtn) { endBtn.style.display = isActive ? "block" : "none"; }

    let modal = document.getElementById("shift-detail-modal"); if (modal) modal.classList.remove("hidden");
}

window.printCurrentShiftReport = async function() {
    const data = window.currentShiftData;
    if (!data) return alert("Data ringkasan shift tidak tersedia untuk dicetak.");
    
    let mt = document.getElementById("meter-token"); data.meterToken = mt ? (parseFloat(mt.value) || 0) : (data.meterToken || 0);
    let mp = document.getElementById("meter-pasca"); data.meterPasca = mp ? (parseFloat(mp.value) || 0) : (data.meterPasca || 0);
    
    if (data.meterToken <= 0 && data.meterPasca <= 0) {
        return alert("⚠️ Harap isi Meteran Listrik (Sisa Token atau Total Pasca) terlebih dahulu sebelum mencetak!");
    }
    
    try {
        if (typeof window.buildShiftReportReceipt === "function") {
            await window.buildShiftReportReceipt(data);
            alert("Laporan penutupan shift berhasil dikirim ke printer!");
        } else {
            alert("⚠️ Modul printer belum terhubung. Silakan nyalakan bluetooth dan klik Printer di menu atas.");
        }
    } catch (e) { alert("Gagal mencetak laporan: " + e.toString()); }
};

window.triggerEndShift = async function() {
    const data = window.currentShiftData; if (!data) return alert("Gagal mengambil data shift kasir.");
    let diffMins = (new Date().getTime() - new Date(currentLoginTime).getTime()) / 60000;
    if (diffMins < 5 && data.totalOrders === 0 && data.totalOmset === 0) {
        if (confirm("Shift ini berjalan kurang dari 5 menit tanpa transaksi.\nApakah Anda ingin membatalkan dan menghapus shift ini tanpa dikirim ke server?")) {
            let tx = db.transaction(["active_shifts"], "readwrite");
            tx.objectStore("active_shifts").delete(currentPin);
            tx.oncomplete = () => { window.location.reload(); };
            return;
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

window.onload = async () => { 
    await initDB(); 
    window.syncMasterData(); 
    
    document.addEventListener("mousedown", function(e) {
        let resBox = document.getElementById('autocomplete-results');
        if (resBox && !e.target.closest('#autocomplete-results') && e.target.id !== 'cust-phone' && e.target.id !== 'cust-name') { 
            resBox.classList.add('hidden'); resBox.style.display = "none"; 
        }
    });

    window.setInterval(window.runBackgroundSync, 5000); 
    window.setInterval(window.syncMasterData, 30000); 
    window.setInterval(checkExpiredShifts, 60000); 
};
