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
// 1. INISIALISASI DATABASE & UTILITY
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
// 2. PRINTER ENGINE (DIKEMBALIKAN UTUH)
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
    if (!btCharacteristic) { alert("Printer belum terhubung! Silakan klik tombol 'Printer: Offline' di atas terlebih dahulu."); return; }
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
// 3. CORE LOGIN & WORKSPACE
// ==========================================
window.attemptLogin = async function() {
    const pinInput = document.getElementById("cashier-pin"); const rawPin = pinInput.value.trim();
    if (!rawPin) return;
    try {
        const hashedPin = await hashString(rawPin);
        db.transaction(["staff"], "readonly").objectStore("staff").get(hashedPin).onsuccess = async (e) => {
            let staff = e.target.result;
            if (staff) {
                db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").get(hashedPin).onsuccess = (shiftReq) => {
                    const activeShift = shiftReq.target.result; currentCashier = staff.name; currentPin = hashedPin;
                    if (activeShift) { currentShiftId = activeShift.shiftId; currentLoginTime = activeShift.loginTime; } 
                    else {
                        currentShiftId = "SHF-" + Date.now(); currentLoginTime = new Date().toISOString(); 
                        db.transaction(["active_shifts"], "readwrite").objectStore("active_shifts").put({pin: hashedPin, shiftId: currentShiftId, loginTime: currentLoginTime, lastActiveTime: Date.now(), cashierName: currentCashier}); 
                    }
                    document.getElementById("login-screen").classList.add("hidden");
                    document.getElementById("pos-screen").classList.remove("hidden");
                    document.getElementById("display-cashier").innerText = currentCashier;
                    window.syncMasterData(); lockMenu(); 
                };
            } else { alert("PIN Kasir Salah atau Belum Sinkron!"); }
        };
    } catch (err) { alert("Terjadi kesalahan sistem login."); } finally { pinInput.value = ""; }
};

window.switchWorkspace = function(type) {
    document.querySelectorAll('.ws-tab').forEach(b => b.classList.remove('active'));
    document.getElementById("main-workspace-wrapper").classList.add("hidden");
    document.getElementById("active-tickets-workspace").classList.add("hidden");
    if (type === 'new') {
        document.getElementById("tab-new-order").classList.add("active");
        document.getElementById("main-workspace-wrapper").classList.remove("hidden");
    } else {
        document.getElementById("tab-active-tickets").classList.add("active");
        document.getElementById("active-tickets-workspace").classList.remove("hidden");
        window.renderActiveTickets(); 
    }
};

window.lockScreen = function() { window.location.reload(); };

// ==========================================
// 4. ANTREAN, PELANGGAN & LOTTERY (UNDIAN)
// ==========================================
window.switchAntrean = function(index) {
    if (currentAntreanIndex === index) return;
    antreans[currentAntreanIndex].cart = [...currentCart];
    antreans[currentAntreanIndex].profile = activeCustomerProfile ? {...activeCustomerProfile} : null;
    antreans[currentAntreanIndex].isLocked = isMenuLocked;
    antreans[currentAntreanIndex].phoneInput = document.getElementById("cust-phone").value;
    antreans[currentAntreanIndex].nameInput = document.getElementById("cust-name").value;
    
    currentAntreanIndex = index;
    currentCart = [...antreans[currentAntreanIndex].cart]; 
    activeCustomerProfile = antreans[currentAntreanIndex].profile ? {...antreans[currentAntreanIndex].profile} : null;
    isMenuLocked = antreans[currentAntreanIndex].isLocked;
    document.getElementById("cust-phone").value = antreans[currentAntreanIndex].phoneInput;
    document.getElementById("cust-name").value = antreans[currentAntreanIndex].nameInput;

    document.querySelectorAll(".antrean-btn").forEach((btn, i) => {
        if (i === index) { btn.classList.add("active"); btn.style.background = "#fff"; btn.style.color = "#2980b9"; } 
        else { btn.classList.remove("active"); btn.style.background = "#bdc3c7"; btn.style.color = "#fff"; }
    });

    if (isMenuLocked) {
        document.getElementById("customer-input-section").classList.remove("hidden");
        document.getElementById("active-customer-banner").classList.add("hidden");
        document.getElementById("glass-overlay").style.opacity = "1";
        document.getElementById("glass-overlay").style.pointerEvents = "auto";
        document.getElementById("promo-indicator").classList.add("hidden");
    } else {
        let pName = activeCustomerProfile ? activeCustomerProfile.name : (document.getElementById("cust-name").value || "Walk-in");
        let pPhone = activeCustomerProfile ? activeCustomerProfile.phone : document.getElementById("cust-phone").value;
        document.getElementById("active-cust-name").innerText = pName;
        document.getElementById("active-cust-phone").innerText = (pPhone && pPhone !== "-" && !pPhone.startsWith("999")) ? `(${pPhone})` : "";
        document.getElementById("customer-input-section").classList.add("hidden");
        document.getElementById("active-customer-banner").classList.remove("hidden");
        document.getElementById("glass-overlay").style.opacity = "0";
        document.getElementById("glass-overlay").style.pointerEvents = "none";
        
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
    if (!activeCustomerProfile) { document.getElementById("promo-indicator").classList.add("hidden"); return; }
    let promoText = `🎁 ${activeCustomerProfile.freeCoins || 0} Koin Gratis! (Poin: ${activeCustomerProfile.points || 0}/${window.loyaltyTarget})`;
    let storedCount = Object.values(activeCustomerProfile.storedRewards || {}).reduce((a,b)=>a+b,0);
    if (storedCount > 0) promoText += ` | <span style="cursor:pointer; text-decoration:underline; color:purple;" onclick="window.showStoredRewards()">🎫 ${storedCount} Undian Tersimpan</span>`;
    
    let pending = antreans[currentAntreanIndex].pendingPromoCode;
    if (pending) promoText += ` | ⏳ Menunggu Checkout: ${pending}`;
    
    document.getElementById("promo-indicator").innerHTML = promoText;
    document.getElementById("promo-indicator").classList.remove("hidden");
};

// DIKEMBALIKAN: DETAIL UNDIAN TERSIMPAN (BISA DIKLIK)
window.showStoredRewards = function() {
    if(!activeCustomerProfile || !activeCustomerProfile.storedRewards) return;
    let items = Object.entries(activeCustomerProfile.storedRewards).filter(([k,v]) => v > 0);
    if(items.length === 0) return alert("Tidak ada hadiah tersimpan.");
    let msg = "🎁 Hadiah Undian Tersimpan:\n\n"; items.forEach(([k,v]) => msg += `- ${v}x ${k}\n`); alert(msg);
};

// DIKEMBALIKAN: FUNGSI PILIH UNDIAN HARIAN (LOTTERY MODAL)
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
    let code = document.getElementById("lottery-select").value; let descDiv = document.getElementById("lottery-desc");
    if(!code) { descDiv.innerHTML = ""; return; }
    let promo = window.globalPromos.find(p => p.code === code);
    if(promo) { descDiv.innerHTML = `<div style="padding:10px; background:#e8f4f8; border-radius:6px; color:#2980b9; font-weight:bold; margin-bottom:15px; text-align:left;">🎁 <strong>Insentif:</strong> Mendapatkan ${promo.rewardQty}x ${promo.rewardItem}</div>`; }
};

window.submitLotteryCode = async function() {
    if (!activeCustomerProfile) return alert("Pilih pelanggan terlebih dahulu!");
    let code = document.getElementById("lottery-select").value; if (!code) return alert("Silakan pilih salah satu promo dari kotak dropdown!");

    let d = new Date(); let todayStr = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0') + "-" + String(d.getDate()).padStart(2,'0');
    let hasPending = await new Promise(resolve => {
        db.transaction(["promo_claims"], "readonly").objectStore("promo_claims").getAll().onsuccess = e => {
            let claims = e.target.result; let found = claims.some(c => c.phone === activeCustomerProfile.phone && String(c.timestamp).startsWith(todayStr));
            resolve(found);
        };
    });

    if (activeCustomerProfile.lastClaimDate === todayStr || hasPending) {
        document.getElementById("lottery-modal").classList.add("hidden");
        return alert("⚠️ Pelanggan ini sudah mengklaim undian hari ini. (Batas maksimal 1 klaim per hari)");
    }

    let promo = window.globalPromos.find(p => p.code === code); if (!promo) return alert("Promo tidak valid.");
    antreans[currentAntreanIndex].pendingPromoCode = code;
    document.getElementById("lottery-modal").classList.add("hidden"); window.updatePromoIndicator();
};

function lockMenu() {
    isMenuLocked = true; activeCustomerProfile = null; 
    let promoContainer = document.getElementById("dynamic-promo-section") || document.getElementById("review-promo-section");
    if (promoContainer) promoContainer.innerHTML = "";
    if (document.getElementById("pay-free")) document.getElementById("pay-free").value = 0;

    document.getElementById("customer-input-section").classList.remove("hidden");
    document.getElementById("active-customer-banner").classList.add("hidden");
    document.getElementById("glass-overlay").style.opacity = "1";
    document.getElementById("glass-overlay").style.pointerEvents = "auto";
    document.getElementById("cust-phone").value = ""; document.getElementById("cust-name").value = "";
    currentCart = []; 
    antreans[currentAntreanIndex] = { cart: [], profile: null, isLocked: true, phoneInput: "", nameInput: "", pendingPromoCode: null };
    window.renderCart();
    document.getElementById("promo-indicator").classList.add("hidden");
}

function proceedToUnlock(phone, name) {
    document.getElementById("active-cust-name").innerText = name; 
    document.getElementById("active-cust-phone").innerText = (phone !== "-" && !phone.startsWith("999")) ? `(${phone})` : "";
    document.getElementById("customer-input-section").classList.add("hidden");
    document.getElementById("active-customer-banner").classList.remove("hidden");
    isMenuLocked = false; document.getElementById("glass-overlay").style.opacity = "0"; 
    setTimeout(() => { document.getElementById("glass-overlay").style.pointerEvents = "none"; }, 300);

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
    if (isGuest) { 
        document.getElementById("cust-phone").value = ""; document.getElementById("cust-name").value = "Walk-in"; activeCustomerProfile = null; 
        proceedToUnlock(phone, name);
    } else { 
        phone = document.getElementById("cust-phone").value.trim(); name = document.getElementById("cust-name").value.trim() || "Pelanggan"; 
        if (phone.length < 5) {
            if (confirm("Daftarkan pelanggan tanpa nomor WhatsApp?")) {
                phone = "999" + Date.now().toString().slice(-7);
                document.getElementById("cust-phone").value = phone;
                if (!document.getElementById("cust-name").value.trim()) document.getElementById("cust-name").value = "Pelanggan Tanpa WA";
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
            document.getElementById("cust-phone").value = activeCustomerProfile.phone;
            document.getElementById("cust-name").value = activeCustomerProfile.name;
            let rb = document.getElementById("autocomplete-results"); if(rb) rb.classList.add("hidden");
            window.updatePromoIndicator();
        }
    };
};

window.handleAutocomplete = function(e) {
    if(!db) return;
    const val = e.target.value.toLowerCase().trim(); 
    const resBox = document.getElementById("autocomplete-results");
    if (!resBox) return;
    
    activeCustomerProfile = null; document.getElementById("promo-indicator").classList.add("hidden");
    
    db.transaction(["members"], "readonly").objectStore("members").getAll().onsuccess = (ev) => {
        let matches = ev.target.result; 
        if (val.length > 0) {
            matches = matches.filter(m => String(m.phone).toLowerCase().includes(val) || String(m.name).toLowerCase().includes(val));
        }
        matches.sort((a, b) => (b.spent || 0) - (a.spent || 0));

        if (matches.length > 0) {
            resBox.innerHTML = matches.map(m => `
                <div class="autocomplete-item" onclick="window.selectMember('${m.phone}')" style="padding: 12px 15px; border-bottom: 1px solid #eef2f3; cursor: pointer; text-align: left; background: #fff; font-size: 15px;">
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
    document.getElementById("edit-old-phone").value = prefill; 
    document.getElementById("edit-new-phone").value = "";
    document.getElementById("edit-member-modal").classList.remove("hidden");
};

window.submitEditMember = function() {
    let oldPhone = document.getElementById("edit-old-phone").value.trim(); 
    let newPhone = document.getElementById("edit-new-phone").value.trim();
    if(!oldPhone || !newPhone) return alert("Nomor tidak boleh kosong.");

    db.transaction(["members"], "readonly").objectStore("members").get(oldPhone).onsuccess = (e) => {
        let member = e.target.result; if (!member) return alert("Nomor lama tidak ditemukan.");
        db.transaction(["phone_updates"], "readwrite").objectStore("phone_updates").add({ id: "UPD-" + Date.now(), oldPhone: oldPhone, newPhone: newPhone, syncStatus: "Pending" });
        member.phone = newPhone;
        let tx = db.transaction(["members"], "readwrite");
        tx.objectStore("members").delete(oldPhone); tx.objectStore("members").put(member);
        alert("Nomor WhatsApp berhasil diubah!"); lockMenu(); document.getElementById("edit-member-modal").classList.add("hidden"); window.runBackgroundSync();
    };
};

// ==========================================
// 5. MENU & NUMPAD & TRANSAKSI (CART)
// ==========================================
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
        card.innerHTML = `<div><h4>${item.name}</h4></div><div class="price-badge">Rp ${item.price.toLocaleString('id-ID')}</div>`;
        card.onclick = () => { if(!isMenuLocked) { if(item.inputMode === "DECIMAL") window.openNumpad(item); else addToCart(item, 1); } };
        grid.appendChild(card);
    });
}

// DIKEMBALIKAN UTUH: FUNGSI NUMPAD DESIMAL
window.openNumpad = function(item) { activeNumpadItem = item; numpadValue = "0"; document.getElementById("numpad-display").innerText = "0"; document.getElementById("numpad-modal").classList.remove("hidden"); };
window.closeNumpad = function() { document.getElementById("numpad-modal").classList.add("hidden"); activeNumpadItem = null; };
window.numpadPress = function(val) {
    if (val === 'DEL') { numpadValue = numpadValue.slice(0, -1) || "0"; } else if (val === '.') { if (!numpadValue.includes('.')) numpadValue += '.'; } else { numpadValue = numpadValue === "0" ? String(val) : numpadValue + val; }
    document.getElementById("numpad-display").innerText = numpadValue;
};
window.confirmNumpad = function() { let qty = parseFloat(numpadValue); if (qty > 0) addToCart(activeNumpadItem, qty); window.closeNumpad(); };

function addToCart(item, qty) {
    let finalQty = qty; const existing = currentCart.find(i => i.itemId === item.itemId);
    if (!existing && item.hasMoq && item.moqQty > 0 && finalQty < item.moqQty) { alert(`⚠️ Minimum Order (MOQ) untuk ${item.name} adalah ${item.moqQty}.\nJumlah otomatis disesuaikan.`); finalQty = item.moqQty; }
    if (existing) { existing.qty += finalQty; } else { currentCart.push({ ...item, qty: finalQty, originalPrice: item.price, expectedCoins: item.expectedCoins, hasMoq: item.hasMoq, moqQty: item.moqQty }); }
    window.renderCart();
}

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
    const container = document.getElementById("cart-items"); container.innerHTML = ""; let total = 0;
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
    document.getElementById("pay-cash").value = 0; document.getElementById("pay-qris").value = 0; document.getElementById("pay-transfer").value = 0;
    document.getElementById("pay-hotel-piutang").value = 0; document.getElementById("pay-tamu-piutang").value = 0; document.getElementById("pay-free").value = 0;
    
    window.cartSubtotal = currentCart.reduce((sum, item) => sum + (item.qty * item.price), 0);
    window.cartGrandTotal = window.cartSubtotal;
    
    let promoHtml = "";
    if (activeCustomerProfile) {
        let cartCoins = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
        let availableFree = activeCustomerProfile.freeCoins || 0; let tempPoints = activeCustomerProfile.points || 0; let maxRedeemable = 0;
        
        for (let i = 0; i < cartCoins; i++) {
            if (availableFree > 0) { maxRedeemable++; availableFree--; } 
            else { tempPoints++; if (tempPoints >= window.loyaltyTarget) { maxRedeemable++; tempPoints -= window.loyaltyTarget; } }
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
    if (promoContainer) {
        promoContainer.innerHTML = promoHtml;
        if (promoHtml) promoContainer.classList.remove("hidden");
        else promoContainer.classList.add("hidden");
    }
 
    document.getElementById("review-subtotal").innerText = `Rp ${window.cartSubtotal.toLocaleString('id-ID')}`;
    document.getElementById("review-grandtotal").innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    window.applyPromo();
    document.getElementById("review-modal").classList.remove("hidden");
};

window.closeReview = function() {
    let reviewModal = document.getElementById("review-modal");
    if (reviewModal) { reviewModal.classList.add("hidden"); }
};

window.applyPromo = function() {
    let totalFreeValue = 0;
    document.querySelectorAll('.promo-input').forEach(input => {
        let max = Number(input.max) || 0; let val = Number(input.value) || 0;
        if (val > max) { val = max; input.value = val; }
        if (val < 0) { val = 0; input.value = 0; }
        totalFreeValue += (val * (Number(input.getAttribute('data-price')) || 0));
    });
 
    document.getElementById("pay-free").value = totalFreeValue; 
    let q = Number(document.getElementById("pay-qris").value) || 0; 
    let t = Number(document.getElementById("pay-transfer").value) || 0; 
    let hp = Number(document.getElementById("pay-hotel-piutang").value) || 0; 
    let tp = Number(document.getElementById("pay-tamu-piutang").value) || 0;
    
    window.cartGrandTotal = Math.max(0, window.cartSubtotal - totalFreeValue);
    document.getElementById("review-grandtotal").innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    
    let autoCash = window.cartGrandTotal - (q + t + hp + tp);
    document.getElementById("pay-cash").value = Math.max(0, autoCash); 
    window.calculateRemaining();
};

window.calculateRemaining = function() {
    const c = Number(document.getElementById("pay-cash").value) || 0; const q = Number(document.getElementById("pay-qris").value) || 0; 
    const t = Number(document.getElementById("pay-transfer").value) || 0; const hp = Number(document.getElementById("pay-hotel-piutang").value) || 0; const tp = Number(document.getElementById("pay-tamu-piutang").value) || 0; 
    const totalAccounted = c + q + t + hp + tp; 
    const remaining = Math.max(0, window.cartGrandTotal - totalAccounted);
    document.getElementById("review-remaining").innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
};

window.finalizeOrder = async function(shouldPrint) {
    const cash = Number(document.getElementById("pay-cash").value) || 0; const qris = Number(document.getElementById("pay-qris").value) || 0; 
    const transfer = Number(document.getElementById("pay-transfer").value) || 0; const hotelPiutang = Number(document.getElementById("pay-hotel-piutang").value) || 0; 
    const tamuPiutang = Number(document.getElementById("pay-tamu-piutang").value) || 0; const free = Number(document.getElementById("pay-free").value) || 0;
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

    let custPhone = document.getElementById("cust-phone").value.trim() || "-";
    const custName = document.getElementById("cust-name").value.trim() || "Walk-in";
    let newPoints = 0; let newFree = 0;

    if (custPhone !== "-") {
        if (!activeCustomerProfile) activeCustomerProfile = { phone: custPhone, name: custName, points: 0, freeCoins: 0, spent: 0, storedRewards: {} };
        activeCustomerProfile.spent += window.cartGrandTotal;
        activeCustomerProfile.freeCoins = Math.max(0, (activeCustomerProfile.freeCoins || 0) - redeemedLoyaltyCoins);
        
        redeemedList.forEach(rp => {
            if (rp.source === 'stored' && activeCustomerProfile.storedRewards) {
                if (activeCustomerProfile.storedRewards[rp.item] !== undefined) {
                    activeCustomerProfile.storedRewards[rp.item] -= rp.qty;
                    if (activeCustomerProfile.storedRewards[rp.item] <= 0) delete activeCustomerProfile.storedRewards[rp.item]; 
                }
            }
        });
        
        let cartCoins = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
        let coinsEarned = Math.max(0, cartCoins - redeemedLoyaltyCoins);
        let currentPoints = (activeCustomerProfile.points || 0) + coinsEarned;
        let newlyEarnedFree = Math.floor(currentPoints / window.loyaltyTarget);
        activeCustomerProfile.points = currentPoints % window.loyaltyTarget;
        activeCustomerProfile.freeCoins += newlyEarnedFree;
        newPoints = activeCustomerProfile.points; newFree = activeCustomerProfile.freeCoins;
        saveMemberToDB(activeCustomerProfile);
    }

    const orderPayload = {
        orderId: "ORD-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId,
        customerName: custName, customerPhone: custPhone, orderStatus: (totalPiutang > 0 ? "Pending Debt" : "Completed"), items: currentCart, subtotal: window.cartSubtotal, discounts: free, grandTotal: window.cartGrandTotal,
        paymentMethod: "Split", cashAmount: cash, qrisAmount: qris, transferAmount: transfer, hotelPiutangAmount: hotelPiutang, tamuPiutangAmount: tamuPiutang, freeAmount: free, remainingDue: 0,
        coinsEarned: 0, redeemedPromos: redeemedList, expectedCoins: 0, internalCoinsUsed: 0, syncStatus: "Pending" 
    };

    db.transaction(["orders"], "readwrite").objectStore("orders").add(orderPayload);
    if (shouldPrint && typeof window.buildEscPosReceipt === "function") {
        await window.buildEscPosReceipt(orderPayload.orderId, orderPayload, (cash + qris + transfer + totalPiutang), 0, "Split", newPoints, newFree);
    }
    document.getElementById("review-modal").classList.add("hidden"); lockMenu(); renderProductGrid(); window.runBackgroundSync();
};

function saveMemberToDB(profile) {
    if(!profile.phone || profile.phone === "-") return;
    db.transaction(["members"], "readwrite").objectStore("members").put(profile);
    db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").put(profile);
}

// ==========================================
// 6. TIKET AKTIF & CUCIAN BERJALAN
// ==========================================
window.renderActiveTickets = function() {
    const grid = document.getElementById("ticket-grid-container"); if(!grid) return;
    grid.innerHTML = "";
    activeLaundryTickets.forEach((ticket) => {
        const isReady = ticket.orderStatus === "Ready for Pickup";
        const totalPaid = (ticket.cashAmount||0) + (ticket.qrisAmount||0) + (ticket.transferAmount||0) + (ticket.freeAmount||0);
        const remaining = ticket.grandTotal - totalPaid;
        let receiptText = ticket.readableReceipt || "";
        if (!receiptText && ticket.items) receiptText = ticket.items.map(i => `${i.qty % 1 !== 0 ? i.qty.toFixed(2) : i.qty}x ${i.name}`).join('\n');
        let buttonsHtml = "";
        if (!isReady) { buttonsHtml = `<button class="ticket-btn" style="background:#f39c12;" onclick="window.markTicketReady('${ticket.orderId}', ${ticket.expectedCoins || 0})">Tandai Selesai Cuci</button>`; } 
        else { buttonsHtml = `<button class="ticket-btn" style="background:#2ecc71;" onclick="window.openSettlement('${ticket.orderId}', ${remaining})">Ambil Cucian & Bayar</button>`; }
        grid.innerHTML += `<div class="ticket-card ${isReady ? 'ready' : ''}"><div class="ticket-header"><span>${ticket.customerName}</span> <span style="color:#7f8c8d; font-size:12px;">${ticket.orderId}</span></div><div style="font-size:14px; margin-bottom:10px; white-space:pre-wrap;">${receiptText}</div><div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:10px; border-top:1px dashed #ddd; padding-top:5px;"><span>Piutang / Sisa:</span> <strong style="color:#e74c3c;">Rp ${remaining.toLocaleString('id-ID')}</strong></div>${buttonsHtml}</div>`;
    });
};

window.markTicketReady = function(orderId, expectedCoins) {
    window.activeDoneOrderId = orderId; 
    let elE = document.getElementById("done-expected-coins"); if(elE) elE.innerText = expectedCoins;
    let elA = document.getElementById("done-actual-coins"); if(elA) elA.value = expectedCoins;
    document.getElementById("ticket-done-modal").classList.remove("hidden");
};

window.submitTicketDone = function() {
    let actual = Number(document.getElementById("done-actual-coins").value) || 0;
    let expected = Number(document.getElementById("done-expected-coins").innerText) || 0;
    if (actual < 0) return alert("Jumlah koin tidak valid.");

    const ticket = activeLaundryTickets.find(t => t.orderId === window.activeDoneOrderId);
    if (ticket) {
        ticket.orderStatus = "Ready for Pickup"; ticket.syncStatus = "Pending";
        db.transaction(["orders"], "readwrite").objectStore("orders").put(ticket);
        if (actual > 0) {
            let overuse = Math.max(0, actual - expected); let baseUsage = Math.min(expected, actual);
            const payload = { logId: "TKC-" + Date.now(), orderId: window.activeDoneOrderId, timestamp: new Date().toISOString(), cashier: currentCashier, expected: baseUsage, overuse: overuse, syncStatus: "Pending" };
            db.transaction(["ticket_coins"], "readwrite").objectStore("ticket_coins").add(payload);
        }
        window.renderActiveTickets(); window.runBackgroundSync();
    }
    document.getElementById("ticket-done-modal").classList.add("hidden");
};

window.openSettlement = function(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
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

// ==========================================
// 7. OPERASIONAL PENGELUARAN LACI
// ==========================================
window.openExpenseModal = function() {
    document.getElementById("expense-modal").classList.remove("hidden");
    const list = document.getElementById("expense-category-list");
    if(list) {
        list.innerHTML = "";
        db.transaction(["expense_categories"], "readonly").objectStore("expense_categories").getAll().onsuccess = (e) => {
            e.target.result.forEach(cat => { const opt = document.createElement("option"); opt.value = cat.name; list.appendChild(opt); });
        };
    }
};

window.saveExpense = function() {
    const amount = Number(document.getElementById("exp-amount").value); const category = document.getElementById("exp-category").value.trim();
    if (amount <= 0 || !category) return alert("Harap masukkan jumlah dan kategori yang benar.");
    db.transaction(["expense_categories"], "readwrite").objectStore("expense_categories").put({ name: category });

    const payload = { expenseId: "EXP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, category: category, description: document.getElementById("exp-desc").value || "-", amount: amount, status: "Active", syncStatus: "Pending" };
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
    } else if (type === 'shifts') {
        const renderShiftsHTML = (shiftsData) => {
            const filtered = shiftsData.filter(s => s.cashier === currentCashier).slice(0, 6);
            if(filtered.length === 0) { container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada histori shift Anda di sistem.</div>`; return; }
            filtered.forEach(s => {
                let detailBtn = `<button onclick="window.viewShiftDetails('${s.shiftId}')" style="background:#f39c12; color:white; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; font-weight:bold;">👁️ Detail</button>`;
                let printBtn = `<button onclick="window.printShiftReportFromHistory('${s.shiftId}')" style="background:#3498db; color:white; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; font-weight:bold;">🖨️ Cetak</button>`;
                container.innerHTML += `<div class="history-row" style="align-items:flex-start;"><div><strong>Shift: ${s.shiftId}</strong><br><small style="color:#7f8c8d;">Kasir: ${s.cashier} | Keluar: ${formatWIB(s.logoutTime)}</small></div><div style="display:flex; text-align:right; align-items:center;"><div><strong style="margin-right:15px;">Omset: Rp ${(s.totalOmset || 0).toLocaleString('id-ID')}</strong></div> ${detailBtn} ${printBtn}</div></div>`;
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
    
    const payload = { dropId: "DRP-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId, toAdmin: admin, toBank: bank, leftInDrawer: drawer, notes: document.getElementById("drop-notes").value || "-", syncStatus: "Pending" };
    db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").add(payload);
    document.getElementById("cashdrop-modal").classList.add("hidden");
    document.getElementById("drop-admin").value = ""; document.getElementById("drop-bank").value = ""; document.getElementById("drop-drawer").value = ""; document.getElementById("drop-notes").value = "";
    alert("Setoran berhasil dicatat!"); window.runBackgroundSync();
};

window.openCoinManagement = function() {
    document.getElementById("coin-management-modal").classList.remove("hidden");
};

window.saveCoinRetrieval = function() {
    const qty = Number(document.getElementById("coin-retrieval-qty").value); if (qty <= 0) return alert("Jumlah koin tidak valid.");
    const payload = { retrievalId: "RET-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, qty: qty, notes: "Daur Ulang Koin Fisik", syncStatus: "Pending" };
    db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload);
    document.getElementById("coin-retrieval-qty").value = ""; alert("Pengambilan koin tercatat (Menunggu Approval)"); window.runBackgroundSync();
};

window.saveCoinJammed = function() {
    const qty = Number(document.getElementById("coin-jammed-qty").value); if (qty <= 0) return alert("Jumlah koin tidak valid.");
    const payload = { retrievalId: "JAM-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, qty: qty, notes: "Mesin Macet / Tertelan", syncStatus: "Pending" };
    db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").add(payload);
    document.getElementById("coin-jammed-qty").value = ""; alert("Koin macet tercatat!"); window.runBackgroundSync();
};

// ==========================================
// 10. SINKRONISASI INTI
// ==========================================
window.syncMasterData = async function() {
    let nTxt = document.getElementById("network-text"); let nDot = document.getElementById("network-dot");
    if (!navigator.onLine) { if(nTxt) nTxt.innerText = "Mode Offline"; if(nDot) nDot.style.backgroundColor = "#e74c3c"; return; }
    try {
        const response = await fetch(API_URL, { method: 'GET', mode: 'cors' }); const result = await response.json();
        if (result.status === "Success") {
            window.masterDrawerBalance = result.masterDrawerBalance || 0;
            window.loyaltyTarget = result.data.loyaltyTarget || 10; window.globalPromos = result.data.promos || [];
            window.globalRecentShifts = result.recentShifts || [];
            
            window.enableDrawerTracking = String(result.data.settings["Enable_Drawer_Tracking"]).toUpperCase() !== "FALSE";
            const btnDrawer = document.getElementById("btn-drawer") || document.getElementById("btn-cashdrop") || document.querySelector("button[onclick*='openCashDrop']");
            if (btnDrawer) btnDrawer.style.display = window.enableDrawerTracking ? "" : "none";

            let txStaff = db.transaction(["staff"], "readwrite");
            txStaff.objectStore("staff").clear();
            result.data.staff.forEach(s => txStaff.objectStore("staff").add(s));

            txStaff.oncomplete = () => {
                let txOthers = db.transaction(["menu", "settings", "members", "expense_categories"], "readwrite");
                txOthers.objectStore("menu").clear(); result.data.menu.forEach(m => txOthers.objectStore("menu").add(m));
                txOthers.objectStore("members").clear(); result.data.members.forEach(m => txOthers.objectStore("members").add(m));
                let expCatStore = txOthers.objectStore("expense_categories"); expCatStore.clear(); 
                if(result.data.expenseCategories) result.data.expenseCategories.forEach(c => expCatStore.add({name: c}));
                let settingsStore = txOthers.objectStore("settings"); settingsStore.clear();
                for (const [key, value] of Object.entries(result.data.settings)) { settingsStore.add({ key: key, value: value }); }
            };
            
            if (result.data.authStatuses) processVoidApprovals(result.data.authStatuses);
            globalMenuData = result.data.menu; activeLaundryTickets = result.data.activeLaundryOrders || [];
            if(document.getElementById("ticket-count")) document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
            if(nTxt) nTxt.innerText = "Online & Sinkron"; if(nDot) nDot.style.backgroundColor = "#2ecc71";
            if (!document.getElementById("pos-screen").classList.contains("hidden")) { loadMenuUI(); window.renderActiveTickets(); }
        }
    } catch (e) { if(nTxt) nTxt.innerText = "Gagal Sinkron"; if(nDot) nDot.style.backgroundColor = "#e74c3c"; }
};

window.manualPushSync = async function() {
    if (!navigator.onLine) return alert("Anda sedang offline!");
    let nTxt = document.getElementById("network-text"); if(nTxt) nTxt.innerText = "Mengirim Data...";
    let nDot = document.getElementById("network-dot"); if(nDot) nDot.style.backgroundColor = "#f39c12";
    await window.runBackgroundSync();
    if(nTxt) nTxt.innerText = "Menarik Data...";
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
        let tx = db.transaction(["orders", "expenses"], "readonly");
        let activeOrders = []; let activeExpenses = [];
        tx.objectStore("orders").getAll().onsuccess = (ev) => { activeOrders = ev.target.result; };
        tx.objectStore("expenses").getAll().onsuccess = (ev) => { activeExpenses = ev.target.result; };

        tx.oncomplete = () => {
            let shiftOrders = activeOrders.filter(o => o.shiftId === currentShiftId && o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending");
            let shiftExpenses = activeExpenses.filter(e => e.shiftId === currentShiftId && e.status === "Active");
            let tCust = 0; let tOrders = 0; let tOmset = 0; let tCash = 0; let tQris = 0; let tTransfer = 0;
            let hPiu = 0; let tPiu = 0; let tFree = 0; let tExpense = 0; let foodSummary = {};

            shiftOrders.forEach(o => {
                tOrders++; if (o.customerPhone && o.customerPhone !== "-") tCust++;
                tOmset += o.grandTotal; tCash += (o.cashAmount || 0); tQris += (o.qrisAmount || 0); tTransfer += (o.transferAmount || 0);
                hPiu += (o.hotelPiutangAmount || 0); tPiu += (o.tamuPiutangAmount || 0); tFree += (o.freeAmount || 0);
                if (o.items) o.items.forEach(i => { foodSummary[i.name] = (foodSummary[i.name] || 0) + i.qty; });
            });
            shiftExpenses.forEach(exp => { tExpense += (exp.amount || 0); });
            let netCash = Math.max(0, tCash - tExpense);

            window.currentShiftData = { shiftId: currentShiftId, loginTime: currentLoginTime, logoutTime: new Date().toISOString(), cashier: currentCashier, totalCustomers: tCust, totalOrders: tOrders, totalOmset: tOmset, totalCash: tCash, totalQris: tQris, totalTransfer: tTransfer, totalHotelPiutang: hPiu, totalTamuPiutang: tPiu, totalFree: tFree, totalExpenses: tExpense, netCash: netCash, foodSummary: foodSummary };
            
            populateShiftModal(window.currentShiftData, true);
        };
    }
};

function populateShiftModal(data, isActive) {
    let foodHtml = "";
    if (data.foodSummary) {
        for (const [name, qty] of Object.entries(data.foodSummary)) {
            foodHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #eee; padding:4px 0;"><span>${name}</span> <strong>${qty}x</strong></div>`;
        }
    }

    if (document.getElementById("sd-id")) document.getElementById("sd-id").innerText = data.shiftId;
    if (document.getElementById("sd-login")) document.getElementById("sd-login").innerText = formatWIB(data.loginTime);
    if (document.getElementById("sd-logout")) document.getElementById("sd-logout").innerText = isActive ? "Saat Ini (Aktif)" : formatWIB(data.logoutTime);
    if (document.getElementById("sd-cash")) document.getElementById("sd-cash").innerText = "Rp " + (data.totalCash || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-qris")) document.getElementById("sd-qris").innerText = "Rp " + (data.totalQris || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-transfer")) document.getElementById("sd-transfer").innerText = "Rp " + (data.totalTransfer || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-hotel-piutang")) document.getElementById("sd-hotel-piutang").innerText = "Rp " + (data.totalHotelPiutang || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-tamu-piutang")) document.getElementById("sd-tamu-piutang").innerText = "Rp " + (data.totalTamuPiutang || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-expenses")) document.getElementById("sd-expenses").innerText = "Rp " + (data.totalExpenses || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-omset")) document.getElementById("sd-omset").innerText = "Rp " + (data.totalOmset || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-net")) document.getElementById("sd-net").innerText = "Rp " + (data.netCash || 0).toLocaleString('id-ID');
    if (document.getElementById("sd-food")) document.getElementById("sd-food").innerHTML = foodHtml || "Belum ada item terjual";

    let modal = document.getElementById("shift-detail-modal"); if (modal) modal.classList.remove("hidden");
}

window.printCurrentShiftReport = async function() {
    const data = window.currentShiftData;
    if (!data) return alert("Data ringkasan shift tidak tersedia untuk dicetak.");
    
    data.meterToken = Number(document.getElementById("meter-token")?.value) || data.meterToken || 0;
    data.meterPasca = Number(document.getElementById("meter-pasca")?.value) || data.meterPasca || 0;
    
    try {
        if (typeof window.buildShiftReportReceipt === "function") {
            await window.buildShiftReportReceipt(data);
        } else {
            alert("⚠️ Modul printer belum terhubung. Silakan nyalakan bluetooth dan klik Printer di menu atas.");
        }
    } catch (e) { alert("Gagal mencetak laporan: " + e.toString()); }
};

window.triggerEndShift = async function() {
    if (!confirm("Apakah Anda yakin ingin MENGAKHIRI SHIFT dan mengunci data keuangan Anda sekarang?\nLaporan penutupan akan langsung dikirim ke Cloud Google Sheet.")) return;
    const data = window.currentShiftData; if (!data) return alert("Gagal mengambil data shift kasir.");
    const meterT = Number(document.getElementById("meter-token")?.value) || 0;
    const meterP = Number(document.getElementById("meter-pasca")?.value) || 0;
    
    const shiftPayload = {
        shiftId: currentShiftId, cashier: currentCashier, loginTime: currentLoginTime, logoutTime: new Date().toISOString(),
        totalCustomers: data.totalCustomers, totalOrders: data.totalOrders, totalOmset: data.totalOmset,
        totalCash: data.totalCash, totalQris: data.totalQris, totalTransfer: data.totalTransfer,
        totalHotelPiutang: data.totalHotelPiutang, totalTamuPiutang: data.totalTamuPiutang, totalFree: data.totalFree,
        totalExpenses: data.totalExpenses, netCash: data.netCash, foodSummary: data.foodSummary,
        meterToken: meterT, meterPasca: meterP, closeNote: "Manual Shift Closure by Cashier", syncStatus: "Pending"
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
        const report = { shiftId: shift.shiftId, cashier: shift.cashierName, loginTime: shift.loginTime, logoutTime: new Date().toISOString(), totalCustomers: vOrders.length, totalOrders: vOrders.length, totalOmset: tOmset, totalCash: tOmset, totalQris: 0, totalTransfer: 0, totalHotelPiutang: 0, totalTamuPiutang: 0, totalFree: 0, totalExpenses: 0, netCash: tOmset, foodSummary: {}, closeNote: "System Auto-Closed (>4h Idle Expired)", syncStatus: "Pending" };
        let txW = db.transaction(["local_shift_history", "shift_reports", "active_shifts"], "readwrite");
        txW.objectStore("local_shift_history").add(report); txW.objectStore("shift_reports").add(report);
        txW.objectStore("active_shifts").delete(shift.pin);
        if (shift.shiftId === currentShiftId) { alert("Shift kadaluarsa!"); window.location.reload(); }
    };
}

// ==========================================
// 12. INITIALIZATION BROWSER DELEGATION
// ==========================================
window.onload = async () => { 
    await initDB(); 
    await window.syncMasterData(); 
    
    document.addEventListener("input", function(e) {
        if (e.target && (e.target.id === "cust-phone" || e.target.id === "cust-name")) { window.handleAutocomplete(e); }
    });
    document.addEventListener("click", function(e) {
        if (e.target && (e.target.id === "cust-phone" || e.target.id === "cust-name")) { window.handleAutocomplete(e); }
        if (e.target && !e.target.closest('.autocomplete-wrapper') && e.target.id !== 'cust-phone' && e.target.id !== 'cust-name') { 
            let rb = document.getElementById('autocomplete-results'); if (rb) { rb.classList.add('hidden'); rb.style.display = "none"; }
        }
    });
    document.addEventListener("focus", function(e) {
        if (e.target && (e.target.id === "cust-phone" || e.target.id === "cust-name")) { window.handleAutocomplete(e); }
    }, true);

    window.setInterval(window.runBackgroundSync, 5000); 
    window.setInterval(window.syncMasterData, 30000); 
    window.setInterval(checkExpiredShifts, 60000); 
};
