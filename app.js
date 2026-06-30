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
window.masterDrawerBalance = 0; let isLoggingOut = false; let currentVoidTarget = { type: null, id: null };
let isMenuLocked = true; let isSyncing = false; let activeCustomerProfile = null; let activeCoinPrice = 10000;
window.loyaltyTarget = 10; window.globalPromos = []; window.enableDrawerTracking = true;

let btDevice = null; let btCharacteristic = null; let printShiftOnLogout = false;
window.lastActivityWrite = Date.now();

// ==========================================
// 1. PWA INSTALLATION MODULE (DIKEMBALIKAN)
// ==========================================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btn-install');
    if (installBtn) installBtn.classList.remove('hidden');
});

window.installPWA = function() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                const installBtn = document.getElementById('btn-install');
                if (installBtn) installBtn.classList.add('hidden');
            }
            deferredPrompt = null;
        });
    }
};

// ==========================================
// 2. INISIALISASI DATABASE & UTILITY
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

function processVoidApprovals(authStatuses) {
    if (!db || !authStatuses) return;
    if (authStatuses.orders) {
        for (const [orderId, info] of Object.entries(authStatuses.orders)) {
            db.transaction(["orders"], "readonly").objectStore("orders").get(orderId).onsuccess = (e) => {
                let order = e.target.result;
                if (order && order.orderStatus !== info.status) {
                    order.orderStatus = info.status; order.voidAuth = info.auth;
                    db.transaction(["orders"], "readwrite").objectStore("orders").put(order);
                }
            };
        }
    }
    if (authStatuses.expenses) {
        for (const [expenseId, info] of Object.entries(authStatuses.expenses)) {
            db.transaction(["expenses"], "readonly").objectStore("expenses").get(expenseId).onsuccess = (e) => {
                let expense = e.target.result;
                if (expense && expense.status !== info.status) {
                    expense.status = info.status;
                    db.transaction(["expenses"], "readwrite").objectStore("expenses").put(expense);
                }
            };
        }
    }
}

async function hashString(str) {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
// 3. PRINTER ENGINE MURNI ESC/POS
// ==========================================
window.connectBluetoothPrinter = async function() {
    try {
        btDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x18F0] }], optionalServices: [0x18F0] });
        const server = await btDevice.gatt.connect();
        const service = await server.getPrimaryService(0x18F0);
        btCharacteristic = await service.getCharacteristic(0x2AF1);
        const btn = document.getElementById("btn-printer");
        if(btn) { btn.innerText = "🖨️ Printer: Terhubung"; btn.style.background = "#2ecc71"; }
    } catch (err) { alert("Gagal terhubung ke printer Bluetooth."); }
};

async function sendToPrinter(payloadUint8) {
    if (!btCharacteristic) { alert("Printer belum terhubung! Pastikan modul nyala dan terkoneksi di menu atas."); return; }
    const chunkSize = 20; 
    for (let i = 0; i < payloadUint8.length; i += chunkSize) {
        const chunk = payloadUint8.slice(i, i + chunkSize);
        await btCharacteristic.writeValue(chunk);
        await new Promise(r => setTimeout(r, 10)); 
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
    const f1 = settings["Footer_1"] || "TERIMA KASIH"; const f2 = settings["Footer_2"] || ""; const f3 = settings["Footer_3"] || ""; 
    
    const CMD_INIT = "\x1B\x40"; const CMD_CENTER = "\x1B\x61\x01"; const CMD_LEFT = "\x1B\x61\x00";
    const CMD_BOLD_ON = "\x1B\x45\x01"; const CMD_BOLD_OFF = "\x1B\x45\x00";
    const CMD_BIG = "\x1B!\x11"; const CMD_NORMAL = "\x1B!\x00"; const CMD_CUT = "\x1D\x56\x41\x10";

    let receipt = CMD_INIT;
    receipt += CMD_CENTER + CMD_BOLD_ON + CMD_BIG + h1 + "\n" + CMD_NORMAL + CMD_BOLD_OFF;
    if(h2) receipt += h2 + "\n";
    if(h3) receipt += h3 + "\n";
    receipt += formatWIB(order.timestamp || new Date().toISOString()) + "\n";
    receipt += "--------------------------------\n" + CMD_LEFT;
    receipt += "Nota: " + orderId + "\nPlgn: " + order.customerName + "\nKsr : " + order.cashier + "\n--------------------------------\n";

    let remainingPromos = [...(order.redeemedPromos || []).map(p => ({...p}))];

    order.items.forEach(item => {
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        const lineTotal = (item.qty * item.originalPrice).toLocaleString('id-ID');
        receipt += formatEscPosLine(`${qtyDisplay}x ${item.name.substring(0,18)}`, lineTotal, false) + "\n";
        for (let i = 0; i < remainingPromos.length; i++) {
            let rp = remainingPromos[i];
            if (rp.qty > 0 && (rp.item === item.name || rp.item === item.subCategory || rp.item === item.category)) {
                let applyQty = Math.min(rp.qty, item.qty);
                if (applyQty > 0) {
                    let discountValue = applyQty * rp.price;
                    receipt += CMD_BOLD_ON + formatEscPosLine(`  >> Promo Hemat!`, "-" + discountValue.toLocaleString('id-ID'), false) + CMD_BOLD_OFF + "\n";
                    rp.qty -= applyQty;
                }
            }
        }
    });

    receipt += "--------------------------------\n";
    receipt += formatEscPosLine("Subtotal", order.subtotal.toLocaleString('id-ID'), false) + "\n";
    if (order.discounts && order.discounts > 0) { receipt += formatEscPosLine("Total Diskon", "-" + order.discounts.toLocaleString('id-ID'), false) + "\n"; }
    receipt += CMD_BOLD_ON + CMD_BIG + formatEscPosLine("TOTAL", order.grandTotal.toLocaleString('id-ID'), true) + "\n" + CMD_NORMAL + CMD_BOLD_OFF + "\n";
    receipt += formatEscPosLine(`Tercatat(${payMethod})`, deposit.toLocaleString('id-ID'), false) + "\n";

    let piutangCount = (order.hotelPiutangAmount || 0) + (order.tamuPiutangAmount || 0);
    if (piutangCount > 0) { receipt += CMD_BOLD_ON + formatEscPosLine("TOTAL PIUTANG", piutangCount.toLocaleString('id-ID'), false) + "\n" + CMD_BOLD_OFF; } 
    else { receipt += CMD_BOLD_ON + formatEscPosLine("STATUS", "LUNAS", false) + "\n" + CMD_BOLD_OFF; }

    if (order.customerPhone && order.customerPhone !== "-" && order.customerPhone !== "Walk-in" && !order.customerPhone.startsWith("999")) {
        receipt += "--------------------------------\n" + CMD_CENTER + "-- INFO POIN LAUNDRY --\n";
        receipt += "Sisa Poin: " + newPoints + "/" + window.loyaltyTarget + "\nKoin Gratis: " + newFree + "\n";
    }

    receipt += "--------------------------------\n" + CMD_CENTER + CMD_BOLD_ON + f1 + "\n" + CMD_BOLD_OFF;
    if(f2) receipt += f2 + "\n";
    if(f3) receipt += f3 + "\n";
    receipt += "\n\n\n\n" + CMD_CUT;

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
    r += CMD_BOLD_ON + "PENERIMAAN KASIR:" + CMD_BOLD_OFF + "\n" + formatEscPosLine("Tunai / Cash", data.totalCash.toLocaleString('id-ID'), false) + "\n" + formatEscPosLine("QRIS", data.totalQris.toLocaleString('id-ID'), false) + "\n" + formatEscPosLine("Transfer Bank", data.totalTransfer.toLocaleString('id-ID'), false) + "\n--------------------------------\n";
    r += CMD_BOLD_ON + "PIUTANG & PENGELUARAN:" + CMD_BOLD_OFF + "\n" + formatEscPosLine("Piutang Hotel", data.totalHotelPiutang.toLocaleString('id-ID'), false) + "\n" + formatEscPosLine("Piutang Tamu", data.totalTamuPiutang.toLocaleString('id-ID'), false) + "\n" + formatEscPosLine("Pengeluaran Laci", data.totalExpenses.toLocaleString('id-ID'), false) + "\n--------------------------------\n";
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
// 4. CORE LOGIN & WORKSPACE
// ==========================================
window.attemptLogin = async function() {
    const pinInput = document.getElementById("cashier-pin"); const rawPin = pinInput.value.trim();
    if (!rawPin) return;
    
    let loginBtn = document.getElementById("btn-login");
    if(loginBtn) loginBtn.innerText = "Memverifikasi...";

    try {
        const hashedPin = await hashString(rawPin);
        
        let staff = await new Promise(res => db.transaction(["staff"], "readonly").objectStore("staff").get(hashedPin).onsuccess = e => res(e.target.result));
        
        if (!staff) {
            if (navigator.onLine) {
                if(loginBtn) loginBtn.innerText = "Menarik Data...";
                await window.syncMasterData(true); 
                staff = await new Promise(res => db.transaction(["staff"], "readonly").objectStore("staff").get(hashedPin).onsuccess = e => res(e.target.result));
            }
        }

        if (staff) {
            db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").get(hashedPin).onsuccess = (shiftReq) => {
                const activeShift = shiftReq.target.result; currentCashier = staff.name; currentPin = hashedPin;
                if (activeShift) { currentShiftId = activeShift.shiftId; currentLoginTime = activeShift.loginTime; } 
                else {
                    currentShiftId = "SHF-" + Date.now(); currentLoginTime = new Date().toISOString(); 
                    db.transaction(["active_shifts"], "readwrite").objectStore("active_shifts").put({pin: hashedPin, shiftId: currentShiftId, loginTime: currentLoginTime, lastActiveTime: Date.now(), cashierName: currentCashier}); 
                }
                let loginScreen = document.getElementById("login-screen"); if (loginScreen) loginScreen.classList.add("hidden");
                let posScreen = document.getElementById("pos-screen"); if (posScreen) posScreen.classList.remove("hidden");
                let displayCashier = document.getElementById("display-cashier"); if (displayCashier) displayCashier.innerText = currentCashier;
                window.lockMenu(); 
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
    let mainWrapper = document.getElementById("main-workspace-wrapper"); if (mainWrapper) mainWrapper.classList.add("hidden");
    let ticketWorkspace = document.getElementById("active-tickets-workspace"); if (ticketWorkspace) ticketWorkspace.classList.add("hidden");
    
    if (type === 'new') {
        let tabNew = document.getElementById("tab-new-order"); if (tabNew) tabNew.classList.add("active");
        if (mainWrapper) mainWrapper.classList.remove("hidden");
    } else {
        let tabTickets = document.getElementById("tab-active-tickets"); if (tabTickets) tabTickets.classList.add("active");
        if (ticketWorkspace) ticketWorkspace.classList.remove("hidden");
        window.renderActiveTickets(); 
    }
};

window.lockScreen = function() { window.location.reload(); };

// ==========================================
// 5. ANTREAN, PELANGGAN & AUTOCOMPLETE 
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
        select.innerHTML = '<option value="">-- Pilih Promo Undian --</option>';
        window.globalPromos.forEach(p => { if(p.weeklyQuota === 0 || p.usedQuota < p.weeklyQuota) { select.innerHTML += `<option value="${p.code}">${p.code} (${p.rewardItem})</option>`; } });
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
    let promoContainer = document.getElementById("dynamic-promo-section") || document.getElementById("review-promo-section");
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
                if(!activeCustomerProfile) activeCustomerProfile = { phone: phone, name: name, points: 0, freeCoins: 0, spent: 0, storedRewards: {} };
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

        if (matches.length > 0) {
            resBox.innerHTML = matches.map(m => `
                <div class="autocomplete-item" onmousedown="window.selectMember('${m.phone}')" style="padding: 12px 15px; border-bottom: 1px solid #eef2f3; cursor: pointer; text-align: left; background: #fff; font-size: 15px; z-index: 10000; position:relative;">
                    <div style="font-weight: bold; color: #2980b9;">${m.phone}</div>
                    <div style="font-size: 13px; color: #555; margin-top:2px;">${m.name}</div>
                </div>
            `).join("");
            resBox.classList.remove("hidden");
            resBox.style.display = "block";
        } else { resBox.classList.add("hidden"); resBox.style.display = "none"; }
    };
};

window.openEditMember = function() {
    let prefill = (activeCustomerProfile && activeCustomerProfile.phone !== "-" && !activeCustomerProfile.isNoWA) ? activeCustomerProfile.phone : "";
    let eop = document.getElementById("edit-old-phone"); if(eop) eop.value = prefill; 
    let enp = document.getElementById("edit-new-phone"); if(enp) enp.value = "";
    let mod = document.getElementById("edit-member-modal"); if(mod) mod.classList.remove("hidden");
};

window.submitEditMember = function() {
    let eop = document.getElementById("edit-old-phone"); let oldPhone = eop ? eop.value.trim() : ""; 
    let enp = document.getElementById("edit-new-phone"); let newPhone = enp ? enp.value.trim() : "";
    if(!oldPhone || !newPhone) return alert("Nomor tidak boleh kosong.");

    db.transaction(["members"], "readonly").objectStore("members").get(oldPhone).onsuccess = (e) => {
        let member = e.target.result; if (!member) return alert("Nomor lama tidak ditemukan.");
        db.transaction(["phone_updates"], "readwrite").objectStore("phone_updates").add({ id: "UPD-" + Date.now(), oldPhone: oldPhone, newPhone: newPhone, syncStatus: "Pending" });
        member.phone = newPhone;
        let tx = db.transaction(["members"], "readwrite");
        tx.objectStore("members").delete(oldPhone); tx.objectStore("members").put(member);
        alert("Nomor WhatsApp berhasil diubah!"); window.lockMenu(); 
        let mod = document.getElementById("edit-member-modal"); if(mod) mod.classList.add("hidden");
        window.runBackgroundSync();
    };
};

// ==========================================
// 6. MENU & NUMPAD & TRANSAKSI (CART)
// ==========================================
function loadMenuUI() {
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
        card.innerHTML = `<div><h4>${item.name}</h4></div><div class="price-badge">Rp ${item.price.toLocaleString('id-ID')}</div>`;
        card.onclick = () => { if(!isMenuLocked) { if(item.inputMode === "DECIMAL") window.openNumpad(item); else window.addToCart(item, 1); } };
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
    if (!existing && item.hasMoq && item.moqQty > 0 && finalQty < item.moqQty) { alert(`⚠️ Minimum Order (MOQ) untuk ${item.name} adalah ${item.moqQty}.\nJumlah otomatis disesuaikan.`); finalQty = item.moqQty; }
    if (existing) { existing.qty += finalQty; } else { currentCart.push({ ...item, qty: finalQty, originalPrice: item.price, expectedCoins: item.expectedCoins, hasMoq: item.hasMoq, moqQty: item.moqQty }); }
    window.renderCart();
};

window.updateCartItemQty = function(itemId, delta) {
    let existing = currentCart.find(i => i.itemId === itemId);
    if (existing) {
        existing.qty += delta;
        if (existing.hasMoq && existing.moqQty > 0) { if (existing.qty > 0 && existing.qty < existing.moqQty) { if (delta < 0) existing.qty = 0; else existing.qty = existing.moqQty; } }
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

// ==========================================
// 7. CHECKOUT & KALKULASI PARADOKS POIN
// ==========================================
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
            promoHtml += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:#fef9e7; padding:10px; border-radius:6px; border:1px solid #f9e79f;">
               <div><strong style="color:#856404;">🎁 Koin Gratis (Loyalty)</strong><br><small style="color:#7d6608;">Maks klaim: ${maxRedeemable}</small></div>
               <input type="number" class="promo-input" data-type="loyalty" data-item="Koin_Fisik" data-price="${activeCoinPrice}" value="0" max="${maxRedeemable}" min="0" oninput="window.applyPromo()" style="width:70px; padding:6px; font-weight:bold; text-align:center; border:1px solid #d4ac0d; border-radius:4px;">
           </div>`;
        }

        if (activeCustomerProfile.storedRewards) {
            for (const [rewardName, qtyOwned] of Object.entries(activeCustomerProfile.storedRewards)) {
                if (qtyOwned > 0) {
                    let cartItem = currentCart.find(i => i.name === rewardName || i.subCategory === rewardName || i.category === rewardName);
                    if (cartItem) {
                        let possibleClaim = Math.min(qtyOwned, Math.floor(cartItem.qty));
                        if (possibleClaim > 0) {
                            promoHtml += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; background:#f9ebff; padding:10px; border-radius:6px; border:1px solid #d6b4fc;">
                               <div><strong style="color:#8e44ad;">🎫 Undian: ${rewardName}</strong><br><small style="color:#6c3483;">Maks guna: ${possibleClaim}</small></div>
                               <input type="number" class="promo-input" data-type="stored" data-item="${rewardName}" data-price="${cartItem.originalPrice}" value="0" max="${possibleClaim}" min="0" oninput="window.applyPromo()" style="width:70px; padding:6px; font-weight:bold; text-align:center; border:1px solid #9b59b6; border-radius:4px;">
                           </div>`;
                        }
                    }
                }
            }
        }
    }

    let promoContainer = document.getElementById("dynamic-promo-section") || document.getElementById("review-promo-section");
    if (promoContainer) { promoContainer.innerHTML = promoHtml; if (promoHtml) promoContainer.classList.remove("hidden"); else promoContainer.classList.add("hidden"); }
 
    let rst = document.getElementById("review-subtotal"); if(rst) rst.innerText = `Rp ${window.cartSubtotal.toLocaleString('id-ID')}`;
    let rgt = document.getElementById("review-grandtotal"); if(rgt) rgt.innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    window.applyPromo();
    
    let mod = document.getElementById("review-modal"); if(mod) mod.classList.remove("hidden");
};
window.reviewOrder = window.openReview;

window.closeReview = function() { let reviewModal = document.getElementById("review-modal"); if (reviewModal) { reviewModal.classList.add("hidden"); } };
window.closeReviewModal = window.closeReview; window.cancelOrder = window.closeReview;

window.applyPromo = function() {
    let totalFreeValue = 0;
    document.querySelectorAll('.promo-input').forEach(input => {
        let max = Number(input.max) || 0; let val = Number(input.value) || 0;
        if (val > max) { val = max; input.value = val; }
        if (val < 0) { val = 0; input.value = 0; }
        totalFreeValue += (val * (Number(input.getAttribute('data-price')) || 0));
    });
 
    let pf = document.getElementById("pay-free"); if (pf) { if (pf.tagName === 'INPUT') pf.value = totalFreeValue; else pf.innerText = totalFreeValue; }
    
    let elQ = document.getElementById("pay-qris"); let q = elQ ? Number(elQ.value) : 0;
    let elT = document.getElementById("pay-transfer"); let t = elT ? Number(elT.value) : 0;
    let elHP = document.getElementById("pay-hotel-piutang"); let hp = elHP ? Number(elHP.value) : 0;
    let elTP = document.getElementById("pay-tamu-piutang"); let tp = elTP ? Number(elTP.value) : 0;
    
    window.cartGrandTotal = Math.max(0, window.cartSubtotal - totalFreeValue);
    let rgt = document.getElementById("review-grandtotal"); if(rgt) rgt.innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    
    let autoCash = window.cartGrandTotal - (q + t + hp + tp);
    let pc = document.getElementById("pay-cash"); if(pc) pc.value = Math.max(0, autoCash); 
    
    window.calculateRemaining();
};

window.calculateRemaining = function() {
    let pc = document.getElementById("pay-cash"); let c = pc ? Number(pc.value) : 0;
    let elQ = document.getElementById("pay-qris"); let q = elQ ? Number(elQ.value) : 0;
    let elT = document.getElementById("pay-transfer"); let t = elT ? Number(elT.value) : 0;
    let elHP = document.getElementById("pay-hotel-piutang"); let hp = elHP ? Number(elHP.value) : 0;
    let elTP = document.getElementById("pay-tamu-piutang"); let tp = elTP ? Number(elTP.value) : 0;
    
    const totalAccounted = c + q + t + hp + tp; 
    const remaining = Math.max(0, window.cartGrandTotal - totalAccounted);
    let rr = document.getElementById("review-remaining"); if(rr) rr.innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
};

window.finalizeOrder = async function(shouldPrint) {
    let pc = document.getElementById("pay-cash"); let cash = pc ? Number(pc.value) : 0;
    let elQ = document.getElementById("pay-qris"); let qris = elQ ? Number(elQ.value) : 0;
    let elT = document.getElementById("pay-transfer"); let transfer = elT ? Number(elT.value) : 0;
    let elHP = document.getElementById("pay-hotel-piutang"); let hotelPiutang = elHP ? Number(elHP.value) : 0;
    let elTP = document.getElementById("pay-tamu-piutang"); let tamuPiutang = elTP ? Number(elTP.value) : 0;
    let pf = document.getElementById("pay-free"); let free = pf ? Number(pf.value) : 0;
    
    const totalPiutang = hotelPiutang + tamuPiutang; 
    if ((window.cartGrandTotal - (cash + qris + transfer + totalPiutang)) > 0) return alert("⚠️ Pembayaran Belum Cukup!");

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
    let expectedCoinsTotal = currentCart.reduce((sum, item) => { let divisor = (item.hasMoq && item.moqQty > 0) ? item.moqQty : 1; let multiplier = Math.ceil(item.qty / divisor); return sum + ((item.expectedCoins || 0) * multiplier); }, 0);

    if (custPhone !== "-") {
        if (!activeCustomerProfile) activeCustomerProfile = { phone: custPhone, name: custName, points: 0, freeCoins: 0, spent: 0, storedRewards: {} };
        activeCustomerProfile.spent += window.cartGrandTotal;
        
        let initialPoints = activeCustomerProfile.points || 0;
        let initialFree = activeCustomerProfile.freeCoins || 0;
        
        let totalPoints = initialPoints + paidCoins;
        let newlyEarnedFree = Math.floor(totalPoints / window.loyaltyTarget);
        let remainingPoints = totalPoints % window.loyaltyTarget;
        let totalFreeGenerated = initialFree + newlyEarnedFree;
        let finalFreeCoins = Math.max(0, totalFreeGenerated - redeemedLoyaltyCoins);

        redeemedList.forEach(rp => {
            if (rp.source === 'stored' && activeCustomerProfile.storedRewards) {
                if (activeCustomerProfile.storedRewards[rp.item] !== undefined) {
                    activeCustomerProfile.storedRewards[rp.item] -= rp.qty;
                    if (activeCustomerProfile.storedRewards[rp.item] <= 0) delete activeCustomerProfile.storedRewards[rp.item]; 
                }
            }
        });

        let pendingPromoCode = antreans[currentAntreanIndex].pendingPromoCode;
        if (pendingPromoCode) {
            let promo = window.globalPromos.find(p => p.code === pendingPromoCode);
            if (promo) {
                if (!activeCustomerProfile.storedRewards) activeCustomerProfile.storedRewards = {};
                activeCustomerProfile.storedRewards[promo.rewardItem] = (activeCustomerProfile.storedRewards[promo.rewardItem] || 0) + promo.rewardQty;
                
                let d = new Date(); let todayStr = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0') + "-" + String(d.getDate()).padStart(2,'0');
                activeCustomerProfile.lastClaimDate = todayStr; 
                
                db.transaction(["promo_claims"], "readwrite").objectStore("promo_claims").add({
                    claimId: "CLM-" + Date.now(), timestamp: todayStr + "T" + d.toLocaleTimeString('en-GB'), phone: activeCustomerProfile.phone, code: pendingPromoCode, rewardItem: promo.rewardItem, rewardQty: promo.rewardQty, cashier: currentCashier, shiftId: currentShiftId, syncStatus: "Pending"
                });
            }
        }
        antreans[currentAntreanIndex].pendingPromoCode = null;
        
        activeCustomerProfile.points = remainingPoints; activeCustomerProfile.freeCoins = finalFreeCoins;
        newPoints = remainingPoints; newFree = finalFreeCoins;
        window.saveMemberToDB(activeCustomerProfile);
    }

    const orderPayload = {
        orderId: "ORD-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId,
        customerName: custName, customerPhone: custPhone, orderStatus: (totalPiutang > 0 ? "Pending Debt" : "Completed"), items: currentCart, subtotal: window.cartSubtotal, discounts: free, grandTotal: window.cartGrandTotal,
        paymentMethod: "Split", cashAmount: cash, qrisAmount: qris, transferAmount: transfer, hotelPiutangAmount: hotelPiutang, tamuPiutangAmount: tamuPiutang, freeAmount: free, remainingDue: 0,
        coinsEarned: paidCoins, redeemedPromos: redeemedList, expectedCoins: expectedCoinsTotal, internalCoinsUsed: 0, syncStatus: "Pending" 
    };

    db.transaction(["orders"], "readwrite").objectStore("orders").add(orderPayload);
    
    if (shouldPrint && typeof window.buildEscPosReceipt === "function") {
        await window.buildEscPosReceipt(orderPayload.orderId, orderPayload, (cash + qris + transfer + totalPiutang), 0, "Split", newPoints, newFree);
    }
    
    let mod = document.getElementById("review-modal"); if(mod) mod.classList.add("hidden");
    window.lockMenu(); renderProductGrid();
