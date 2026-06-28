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
let globalMenuData = []; let currentCategory = ""; let activeLaundryTickets = [];
let currentCart = []; let activeNumpadItem = null; let numpadValue = "0";
let activeSettlementTicket = null; window.masterDrawerBalance = 0; let isLoggingOut = false;
let currentVoidTarget = { type: null, id: null };
let isMenuLocked = true; let isSyncing = false; 
let activeCustomerProfile = null; let activeCoinPrice = 10000;
window.loyaltyTarget = 10; window.globalPromos = [];
window.enableDrawerTracking = true;

let btDevice = null;
let btCharacteristic = null;
let printShiftOnLogout = false;
window.lastActivityWrite = Date.now();

async function hashString(str) {
    const msgUint8 = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatWIB(dateString) { return new Date(dateString).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') + ' WIB'; }
function formatTimeOnlyWIB(dateString) { return new Date(dateString).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' }) + ' WIB'; }

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; const installBtn = document.getElementById('btn-install'); if(installBtn) installBtn.classList.remove('hidden'); });
function installPWA() { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then((choiceResult) => { if (choiceResult.outcome === 'accepted') document.getElementById('btn-install').classList.add('hidden'); deferredPrompt = null; }); } }

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
        request.onsuccess = (e) => { db = e.target.result; db.onversionchange = () => { db.close(); window.location.reload(); }; resolve(db); };
        request.onerror = (e) => { console.error("IndexedDB Error:", e); reject(e); };
        request.onblocked = () => { alert("⚠️ Mohon TUTUP tab aplikasi POS yang lain agar sistem bisa diperbarui ke versi terbaru!"); };
    });
}

function getDynamicSettings() {
    return new Promise((resolve) => {
        let settings = {};
        db.transaction(["settings"], "readonly").objectStore("settings").getAll().onsuccess = (e) => {
            if (e.target.result) { e.target.result.forEach(s => { settings[s.key] = s.value; }); }
            resolve(settings);
        };
    });
}

async function connectBluetoothPrinter() {
    try {
        btDevice = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x18F0] }], optionalServices: [0x18F0] });
        const server = await btDevice.gatt.connect();
        const service = await server.getPrimaryService(0x18F0);
        btCharacteristic = await service.getCharacteristic(0x2AF1);
        const btn = document.getElementById("btn-printer");
        if(btn) { btn.innerText = "🖨️ Printer: Terhubung"; btn.style.background = "#2ecc71"; btn.style.borderColor = "#2ecc71"; }
    } catch (err) { alert("Gagal terhubung ke printer Bluetooth. Pastikan bluetooth menyala dan printer dihidupkan."); }
}

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
    const maxLen = isBig ? 16 : 32;
    const leftStr = String(left);
    const rightStr = String(right);
    const spaceNeeded = maxLen - (leftStr.length + rightStr.length);

    if (spaceNeeded > 0) {
        return leftStr + " ".repeat(spaceNeeded) + rightStr;
    } else {
        const paddingNeeded = maxLen - rightStr.length;
        const padStr = paddingNeeded > 0 ? " ".repeat(paddingNeeded) : "";
        return leftStr + "\n" + padStr + rightStr;
    }
}

function logUserActivity() {
    let now = Date.now();
    if (currentPin && (now - window.lastActivityWrite > 5 * 60 * 1000)) {
        window.lastActivityWrite = now;
        let tx = db.transaction(["active_shifts"], "readwrite");
        let store = tx.objectStore("active_shifts");
        store.get(currentPin).onsuccess = (e) => {
            let shift = e.target.result;
            if (shift) {
                shift.lastActiveTime = now;
                store.put(shift);
            }
        };
    }
}
['click', 'touchstart', 'mousemove', 'keydown'].forEach(evt => {
    window.addEventListener(evt, logUserActivity, { passive: true });
});

async function buildEscPosReceipt(orderId, order, deposit, remaining, payMethod, newPoints, newFree) {
    const settings = await getDynamicSettings();
    const h1 = settings["Header_1"] || "GRIYA LAUNDRY"; const h2 = settings["Header_2"] || ""; const h3 = settings["Header_3"] || ""; 
    const f1 = settings["Footer_1"] || "TERIMA KASIH"; const f2 = settings["Footer_2"] || ""; const f3 = settings["Footer_3"] || ""; 
    
    const CMD_INIT = "\x1B\x40";
    const CMD_CENTER = "\x1B\x61\x01";
    const CMD_LEFT = "\x1B\x61\x00";
    const CMD_BOLD_ON = "\x1B\x45\x01";
    const CMD_BOLD_OFF = "\x1B\x45\x00";
    const CMD_BIG = "\x1B!\x11";
    const CMD_NORMAL = "\x1B!\x00";
    const CMD_CUT = "\x1D\x56\x41\x10";

    let receipt = CMD_INIT;
    receipt += CMD_CENTER + CMD_BOLD_ON + CMD_BIG + h1 + "\n" + CMD_NORMAL + CMD_BOLD_OFF;
    if(h2) receipt += h2 + "\n";
    if(h3) receipt += h3 + "\n";
    receipt += formatWIB(order.timestamp || new Date().toISOString()) + "\n";
    receipt += "--------------------------------\n";
    receipt += CMD_LEFT;
    receipt += "Nota: " + orderId + "\n";
    receipt += "Plgn: " + order.customerName + "\n";
    receipt += "Ksr : " + order.cashier + "\n";
    receipt += "--------------------------------\n";

    let remainingPromos = [...(order.redeemedPromos || []).map(p => ({...p}))];

    order.items.forEach(item => {
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        const lineTotal = (item.qty * item.originalPrice).toLocaleString('id-ID');
        const leftStr = `${qtyDisplay}x ${item.name.substring(0,18)}`;
        receipt += formatEscPosLine(leftStr, lineTotal, false) + "\n";
        
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
    if (order.discounts && order.discounts > 0) {
        receipt += formatEscPosLine("Total Diskon", "-" + order.discounts.toLocaleString('id-ID'), false) + "\n";
    }
    receipt += CMD_BOLD_ON + CMD_BIG + formatEscPosLine("TOTAL", order.grandTotal.toLocaleString('id-ID'), true) + "\n" + CMD_NORMAL + CMD_BOLD_OFF;
    receipt += "\n";
    receipt += formatEscPosLine(`Tercatat(${payMethod})`, deposit.toLocaleString('id-ID'), false) + "\n";

    let piutangCount = (order.hotelPiutangAmount || 0) + (order.tamuPiutangAmount || 0);
    if (piutangCount > 0) {
        receipt += CMD_BOLD_ON + formatEscPosLine("TOTAL PIUTANG", piutangCount.toLocaleString('id-ID'), false) + "\n" + CMD_BOLD_OFF;
    } else {
        receipt += CMD_BOLD_ON + formatEscPosLine("STATUS", "LUNAS", false) + "\n" + CMD_BOLD_OFF;
    }

    if (order.customerPhone && order.customerPhone !== "-" && order.customerPhone !== "Walk-in" && !order.customerPhone.startsWith("999")) {
        receipt += "--------------------------------\n";
        receipt += CMD_CENTER + "-- INFO POIN LAUNDRY --\n";
        receipt += "Sisa Poin: " + newPoints + "/" + window.loyaltyTarget + "\n";
        receipt += "Koin Gratis Tersedia: " + newFree + "\n";
    }

    receipt += "--------------------------------\n";
    receipt += CMD_CENTER + CMD_BOLD_ON + f1 + "\n" + CMD_BOLD_OFF;
    if(f2) receipt += f2 + "\n";
    if(f3) receipt += f3 + "\n";
    receipt += "\n\n\n\n"; 
    receipt += CMD_CUT;

    const encoder = new TextEncoder();
    const payload = encoder.encode(receipt);
    await sendToPrinter(payload);
}

async function buildShiftReportReceipt(data) {
    const settings = await getDynamicSettings();
    const h1 = settings["Header_1"] || "GRIYA LAUNDRY";
    
    const CMD_INIT = "\x1B\x40";
    const CMD_CENTER = "\x1B\x61\x01";
    const CMD_LEFT = "\x1B\x61\x00";
    const CMD_BOLD_ON = "\x1B\x45\x01";
    const CMD_BOLD_OFF = "\x1B\x45\x00";
    const CMD_BIG = "\x1B!\x11";
    const CMD_NORMAL = "\x1B!\x00";
    const CMD_CUT = "\x1D\x56\x41\x10";

    let r = CMD_INIT;
    r += CMD_CENTER + CMD_BOLD_ON + CMD_BIG + h1 + "\n" + CMD_NORMAL + CMD_BOLD_OFF;
    r += "LAPORAN TUTUP SHIFT\n";
    r += "--------------------------------\n";
    r += CMD_LEFT;
    r += "ID Shift: " + data.shiftId + "\n";
    r += "Kasir   : " + data.cashier + "\n";
    r += "Login   : " + formatTimeOnlyWIB(data.loginTime) + "\n";
    r += "Logout  : " + formatTimeOnlyWIB(data.logoutTime) + "\n";
    r += "--------------------------------\n";
    r += formatEscPosLine("Total Nota", data.totalOrders, false) + "\n";
    r += formatEscPosLine("Total Pelanggan", data.totalCustomers, false) + "\n";
    r += "--------------------------------\n";
    r += CMD_BOLD_ON + "PENERIMAAN KASIR:" + CMD_BOLD_OFF + "\n";
    r += formatEscPosLine("Tunai / Cash", data.totalCash.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("QRIS", data.totalQris.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("Transfer Bank", data.totalTransfer.toLocaleString('id-ID'), false) + "\n";
    r += "--------------------------------\n";
    r += CMD_BOLD_ON + "PIUTANG & PENGELUARAN:" + CMD_BOLD_OFF + "\n";
    r += formatEscPosLine("Piutang Hotel", data.totalHotelPiutang.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("Piutang Tamu", data.totalTamuPiutang.toLocaleString('id-ID'), false) + "\n";
    r += formatEscPosLine("Pengeluaran Laci", data.totalExpenses.toLocaleString('id-ID'), false) + "\n";
    r += "--------------------------------\n";
    r += CMD_BOLD_ON + "RANGKUMAN AKHIR:" + CMD_BOLD_OFF + "\n";
    r += formatEscPosLine("Omset Kotor", data.totalOmset.toLocaleString('id-ID'), false) + "\n";
    r += "\n";
    
    let laciTitle = window.enableDrawerTracking ? "SALDO LACI" : "SETOR ADMIN";
    r += CMD_BOLD_ON + formatEscPosLine(laciTitle, data.netCash.toLocaleString('id-ID'), false) + CMD_BOLD_OFF + "\n";
    
    if (data.foodSummary && Object.keys(data.foodSummary).length > 0) {
        r += "--------------------------------\n";
        r += CMD_CENTER + "RINGKASAN ITEM TERJUAL\n" + CMD_LEFT;
        for (const [name, qty] of Object.entries(data.foodSummary)) {
            let qtyStr = (qty % 1 !== 0) ? Number(qty).toFixed(2) : String(qty);
            r += formatEscPosLine(qtyStr + "x " + name.substring(0,25), "", false) + "\n";
        }
    }
    
    r += "\n\n\n\n"; 
    r += CMD_CUT;

    const encoder = new TextEncoder();
    const payload = encoder.encode(r);
    await sendToPrinter(payload);
}

async function attemptLogin() {
    const pinInput = document.getElementById("cashier-pin"); const rawPin = pinInput.value.trim();
    if (!rawPin) return;
    const loginBtn = document.getElementById("btn-login");
    if (loginBtn) { loginBtn.disabled = true; loginBtn.innerText = "Memverifikasi..."; }

    try {
        const hashedPin = await hashString(rawPin);
        const verifyPin = () => { return new Promise((resolve) => { db.transaction(["staff"], "readonly").objectStore("staff").get(hashedPin).onsuccess = (e) => resolve(e.target.result); }); };
        let staff = await verifyPin();

        if (!staff) {
            let nTxt = document.getElementById("login-network-text"); if(nTxt) nTxt.innerText = "Menarik data server...";
            await syncMasterData(); staff = await verifyPin(); 
        }

        if (staff) {
            db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").get(hashedPin).onsuccess = (shiftReq) => {
                const activeShift = shiftReq.target.result; currentCashier = staff.name; currentPin = hashedPin;
                if (activeShift) { currentShiftId = activeShift.shiftId; currentLoginTime = activeShift.loginTime; } 
                else { 
                    currentShiftId = "SHF-" + Date.now(); currentLoginTime = new Date().toISOString(); 
                    db.transaction(["active_shifts"], "readwrite").objectStore("active_shifts").put({pin: hashedPin, shiftId: currentShiftId, loginTime: currentLoginTime, lastActiveTime: Date.now(), cashierName: currentCashier}); 
                }
                document.getElementById("login-screen").classList.add("hidden"); document.getElementById("pos-screen").classList.remove("hidden"); 
                document.getElementById("display-cashier").innerText = currentCashier; document.getElementById("main-workspace-wrapper").classList.remove("hidden");
                syncMasterData(); lockMenu(); 
            };
        } else { alert("PIN Salah! Data tidak ditemukan."); }
    } catch (err) { alert("Terjadi kesalahan sistem."); } finally {
        if (loginBtn) { loginBtn.disabled = false; loginBtn.innerText = "Masuk / Buka Shift"; }
        pinInput.value = "";
    }
}

function switchWorkspace(type) {
    document.querySelectorAll('.ws-tab').forEach(b => b.classList.remove('active'));
    document.getElementById("main-workspace-wrapper").classList.add("hidden"); document.getElementById("active-tickets-workspace").classList.add("hidden");
    if (type === 'new') { document.getElementById("tab-new-order").classList.add("active"); document.getElementById("main-workspace-wrapper").classList.remove("hidden"); 
    } else { document.getElementById("tab-active-tickets").classList.add("active"); document.getElementById("active-tickets-workspace").classList.remove("hidden"); renderActiveTickets(); }
}

window.switchAntrean = function(index) {
    if (currentAntreanIndex === index) return;
    antreans[currentAntreanIndex].cart = [...currentCart]; antreans[currentAntreanIndex].profile = activeCustomerProfile ? {...activeCustomerProfile} : null;
    antreans[currentAntreanIndex].isLocked = isMenuLocked; antreans[currentAntreanIndex].phoneInput = document.getElementById("cust-phone").value;
    antreans[currentAntreanIndex].nameInput = document.getElementById("cust-name").value;
    
    currentAntreanIndex = index;
    currentCart = [...antreans[currentAntreanIndex].cart]; activeCustomerProfile = antreans[currentAntreanIndex].profile ? {...antreans[currentAntreanIndex].profile} : null;
    isMenuLocked = antreans[currentAntreanIndex].isLocked; document.getElementById("cust-phone").value = antreans[currentAntreanIndex].phoneInput;
    document.getElementById("cust-name").value = antreans[currentAntreanIndex].nameInput;

    document.querySelectorAll(".antrean-btn").forEach((btn, i) => {
        if (i === index) { btn.classList.add("active"); btn.style.background = "#fff"; btn.style.color = "#2980b9"; } 
        else { btn.classList.remove("active"); btn.style.background = "#bdc3c7"; btn.style.color = "#fff"; }
    });

    if (isMenuLocked) {
        document.getElementById("customer-input-section").classList.remove("hidden"); document.getElementById("active-customer-banner").classList.add("hidden");
        document.getElementById("glass-overlay").style.opacity = "1"; document.getElementById("glass-overlay").style.pointerEvents = "auto";
        document.getElementById("promo-indicator").classList.add("hidden");
    } else {
        let pName = activeCustomerProfile ? activeCustomerProfile.name : (document.getElementById("cust-name").value || "Walk-in");
        let pPhone = activeCustomerProfile ? activeCustomerProfile.phone : document.getElementById("cust-phone").value;
        document.getElementById("active-cust-name").innerText = pName; document.getElementById("active-cust-phone").innerText = (pPhone && pPhone !== "-" && !pPhone.startsWith("999")) ? `(${pPhone})` : "";
        document.getElementById("customer-input-section").classList.add("hidden"); document.getElementById("active-customer-banner").classList.remove("hidden");
        document.getElementById("glass-overlay").style.opacity = "0"; document.getElementById("glass-overlay").style.pointerEvents = "none";
        
        let d = new Date();
        let todayStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
        const lotteryBtn = document.getElementById("btn-trigger-lottery");
        if (lotteryBtn) {
            if (activeCustomerProfile && (activeCustomerProfile.lastClaimDate === todayStr || activeCustomerProfile.isNoWA)) {
                lotteryBtn.disabled = true;
                lotteryBtn.innerText = "🎫 Sudah Klaim Hari Ini";
            } else {
                lotteryBtn.disabled = false;
                lotteryBtn.innerText = "🎫 Pilih Undian";
            }
        }
        
        updatePromoIndicator();
    }
    document.getElementById("autocomplete-results").classList.add("hidden"); renderCart();
}

function updatePromoIndicator() {
    if (!activeCustomerProfile) { document.getElementById("promo-indicator").classList.add("hidden"); return; }
    let promoText = "";
    if (activeCustomerProfile.freeCoins > 0) promoText += `🎁 ${activeCustomerProfile.freeCoins} Koin Gratis! `;
    promoText += `(Poin: ${activeCustomerProfile.points}/${window.loyaltyTarget})`;
    let storedCount = Object.values(activeCustomerProfile.storedRewards || {}).reduce((a,b)=>a+b,0);
    if (storedCount > 0) promoText += ` | <span style="cursor:pointer; text-decoration:underline; color:purple;" onclick="showStoredRewards()">🎫 ${storedCount} Undian Tersimpan</span>`;
    let pending = antreans[currentAntreanIndex].pendingPromoCode;
    if (pending) promoText += ` | ⏳ Menunggu Checkout: ${pending}`;
    document.getElementById("promo-indicator").innerHTML = promoText; document.getElementById("promo-indicator").classList.remove("hidden");
}

window.showStoredRewards = function() {
    if(!activeCustomerProfile || !activeCustomerProfile.storedRewards) return;
    let items = Object.entries(activeCustomerProfile.storedRewards).filter(([k,v]) => v > 0);
    if(items.length === 0) return alert("Tidak ada hadiah tersimpan.");
    let msg = "🎁 Hadiah Undian Tersimpan:\n\n";
    items.forEach(([k,v]) => msg += `- ${v}x ${k}\n`);
    alert(msg);
};

function lockMenu() {
    isMenuLocked = true; activeCustomerProfile = null; 
    document.getElementById("customer-input-section").classList.remove("hidden"); document.getElementById("active-customer-banner").classList.add("hidden");
    document.getElementById("glass-overlay").style.opacity = "1"; document.getElementById("glass-overlay").style.pointerEvents = "auto";
    document.getElementById("cust-phone").value = ""; document.getElementById("cust-name").value = ""; currentCart = []; 
    antreans[currentAntreanIndex].cart = []; antreans[currentAntreanIndex].profile = null; antreans[currentAntreanIndex].isLocked = true;
    antreans[currentAntreanIndex].phoneInput = ""; antreans[currentAntreanIndex].nameInput = ""; antreans[currentAntreanIndex].pendingPromoCode = null;
    renderCart(); document.getElementById("promo-indicator").classList.add("hidden");
}

function proceedToUnlock(phone, name) {
    document.getElementById("active-cust-name").innerText = name; 
    document.getElementById("active-cust-phone").innerText = (phone !== "-" && !phone.startsWith("999")) ? `(${phone})` : "";
    document.getElementById("customer-input-section").classList.add("hidden"); 
    document.getElementById("active-customer-banner").classList.remove("hidden");
    isMenuLocked = false; 
    document.getElementById("glass-overlay").style.opacity = "0"; 
    setTimeout(() => { document.getElementById("glass-overlay").style.pointerEvents = "none"; }, 300);

    antreans[currentAntreanIndex].isLocked = false; 
    antreans[currentAntreanIndex].phoneInput = phone;
    antreans[currentAntreanIndex].nameInput = name; 
    antreans[currentAntreanIndex].profile = activeCustomerProfile ? {...activeCustomerProfile} : null;
    
    let d = new Date();
    let todayStr = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0') + "-" + String(d.getDate()).padStart(2, '0');
    const lotteryBtn = document.getElementById("btn-trigger-lottery");

    if (lotteryBtn) {
        if (activeCustomerProfile && (activeCustomerProfile.lastClaimDate === todayStr || activeCustomerProfile.isNoWA)) {
            lotteryBtn.disabled = true;
            lotteryBtn.innerText = "🎫 Sudah Klaim Hari Ini";
            lotteryBtn.title = "Pelanggan ini sudah mengambil jatah undian untuk hari ini.";
        } else {
            lotteryBtn.disabled = false;
            lotteryBtn.innerText = "🎫 Pilih Undian";
            lotteryBtn.title = "";
        }
    }
    
    updatePromoIndicator();
    document.getElementById("autocomplete-results").classList.add("hidden"); 
    renderCart();
}

function unlockMenu(isGuest) {
    let phone = "-"; 
    let name = "Walk-in";
    
    if (isGuest) { 
        document.getElementById("cust-phone").value = ""; 
        document.getElementById("cust-name").value = "Walk-in"; 
        activeCustomerProfile = null; 
    } else { 
        phone = document.getElementById("cust-phone").value.trim(); 
        name = document.getElementById("cust-name").value.trim() || "Pelanggan"; 
        
        if (phone.length < 5) {
            let confirm1 = confirm("Apakah pelanggan tidak bersedia memberikan Nomor WhatsApp?");
            if (confirm1) {
                let confirm2 = confirm("Konfirmasi ulang: Daftarkan pelanggan tanpa nomor WhatsApp? (Sistem akan membuatkan ID otomatis dan disimpan ke database)");
                if (confirm2) {
                    phone = "999" + Date.now().toString().slice(-7); 
                    document.getElementById("cust-phone").value = phone;
                    if (!document.getElementById("cust-name").value.trim()) {
                        name = "Pelanggan Tanpa WA";
                        document.getElementById("cust-name").value = name;
                    }
                } else {
                    return;
                }
            } else {
                return; 
            }
        } 
    }

    let isDuplicate = false;
    for (let i = 0; i < antreans.length; i++) {
        if (i === currentAntreanIndex) continue;
        let otherPhone = antreans[i].profile ? antreans[i].profile.phone : (antreans[i].isLocked ? "" : antreans[i].phoneInput);
        if (!antreans[i].isLocked && phone !== "-" && otherPhone === phone) { isDuplicate = true; break; }
    }
    if (isDuplicate) return alert("⚠️ Pelanggan ini sedang dilayani di Antrean lain. Silakan selesaikan atau batalkan transaksi di antrean tersebut terlebih dahulu.");

    if (!isGuest) {
        db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (e) => {
            if (e.target.result) {
                activeCustomerProfile = e.target.result;
            } else {
                activeCustomerProfile = { 
                    phone: phone, 
                    name: name, 
                    points: 0, 
                    freeCoins: 0, 
                    spent: 0, 
                    storedRewards: {}, 
                    lastClaimDate: "",
                    isNoWA: phone.startsWith("999")
                };
            }
            proceedToUnlock(phone, name);
        };
    } else {
        proceedToUnlock(phone, name);
    }
}

window.selectMember = function(phone) {
    for (let i = 0; i < antreans.length; i++) {
        if (i === currentAntreanIndex) continue;
        let otherPhone = antreans[i].profile ? antreans[i].profile.phone : (antreans[i].isLocked ? "" : antreans[i].phoneInput);
        if (!antreans[i].isLocked && otherPhone === phone) { return alert("⚠️ Pelanggan ini sedang dilayani di Antrean " + (i+1) + "."); }
    }

    db.transaction(["members"], "readonly").objectStore("members").get(phone).onsuccess = (e) => {
        activeCustomerProfile = e.target.result;
        document.getElementById("cust-phone").value = activeCustomerProfile.phone; document.getElementById("cust-name").value = activeCustomerProfile.name;
        document.getElementById("autocomplete-results").classList.add("hidden");
        updatePromoIndicator();
    };
};

function openEditMember() {
    let prefill = (activeCustomerProfile && activeCustomerProfile.phone !== "-" && !activeCustomerProfile.isNoWA) ? activeCustomerProfile.phone : "";
    document.getElementById("edit-old-phone").value = prefill; 
    document.getElementById("edit-new-phone").value = "";
    document.getElementById("edit-member-modal").classList.remove("hidden");
}

function submitEditMember() {
    let oldPhone = document.getElementById("edit-old-phone").value.trim(); 
    let newPhone = document.getElementById("edit-new-phone").value.trim();
    
    if (!oldPhone) return alert("Nomor lama tidak boleh kosong.");
    if (!newPhone) return alert("Nomor baru tidak boleh kosong.");

    db.transaction(["members"], "readonly").objectStore("members").get(oldPhone).onsuccess = (e) => {
        let member = e.target.result;
        if (!member) return alert("Nomor lama tidak ditemukan di database pelanggan. Coba periksa kembali.");

        db.transaction(["phone_updates"], "readwrite").objectStore("phone_updates").add({ id: "UPD-" + Date.now(), oldPhone: oldPhone, newPhone: newPhone, syncStatus: "Pending" });
        
        member.phone = newPhone;
        let tx = db.transaction(["members"], "readwrite"); 
        let store = tx.objectStore("members");
        store.delete(oldPhone); 
        store.put(member);

        if (activeCustomerProfile && activeCustomerProfile.phone === oldPhone) {
            activeCustomerProfile.phone = newPhone; 
            document.getElementById("active-cust-phone").innerText = `(${newPhone})`;
            document.getElementById("cust-phone").value = newPhone; 
            antreans[currentAntreanIndex].phoneInput = newPhone;
        }

        antreans.forEach(a => {
            if (a.profile && a.profile.phone === oldPhone) {
                a.profile.phone = newPhone;
                a.phoneInput = newPhone;
            }
        });

        document.getElementById("edit-member-modal").classList.add("hidden"); 
        alert("Nomor WhatsApp berhasil diupdate!"); 
        runBackgroundSync();
    };
}

async function manualPushSync() {
    if (!navigator.onLine) return alert("Anda sedang offline!"); document.getElementById("network-text").innerText = "Mengirim Data..."; document.getElementById("network-dot").style.backgroundColor = "#f39c12"; await runBackgroundSync(); document.getElementById("network-text").innerText = "Menarik Data..."; await syncMasterData(); alert("Sinkronisasi Database Berhasil!");
}

async function syncMasterData() {
    let netText1 = document.getElementById("network-text"); let netText2 = document.getElementById("login-network-text");
    let netDot1 = document.getElementById("network-dot"); let netDot2 = document.getElementById("login-network-dot");

    if (!navigator.onLine) {
        if(netText1) netText1.innerText = "Mode Offline"; if(netText2) netText2.innerText = "Mode Offline (Gagal Tarik PIN)";
        if(netDot1) netDot1.style.backgroundColor = "#e74c3c"; if(netDot2) netDot2.style.backgroundColor = "#e74c3c"; return;
    }
    
    if(netText1) netText1.innerText = "Sinkronisasi..."; if(netText2) netText2.innerText = "Menarik Database...";
    if(netDot1) netDot1.style.backgroundColor = "#f39c12"; if(netDot2) netDot2.style.backgroundColor = "#f39c12";

    try {
        const response = await fetch(API_URL, { method: 'GET', mode: 'cors', redirect: 'follow' }); 
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        
        if (result.status === "Success") {
            window.masterDrawerBalance = result.masterDrawerBalance || 0; window.loyaltyTarget = result.data.loyaltyTarget || 10; window.globalPromos = result.data.promos || [];
            
            window.enableDrawerTracking = String(result.data.settings["Enable_Drawer_Tracking"]).toUpperCase() !== "FALSE";
            const btnDrawer = document.getElementById("btn-drawer"); 
            if (btnDrawer) btnDrawer.style.display = window.enableDrawerTracking ? "" : "none";
            
            const tx = db.transaction(["staff", "menu", "settings", "members", "expense_categories"], "readwrite");
            tx.onerror = (event) => { console.error("Database Transaction Error:", event.target.error); };

            const staffStore = tx.objectStore("staff"); staffStore.clear(); result.data.staff.forEach(s => staffStore.add(s));
            const menuStore = tx.objectStore("menu"); menuStore.clear(); result.data.menu.forEach(m => menuStore.add(m));
            const memStore = tx.objectStore("members"); memStore.clear(); result.data.members.forEach(m => memStore.add(m));
            const expCatStore = tx.objectStore("expense_categories"); expCatStore.clear(); if(result.data.expenseCategories) result.data.expenseCategories.forEach(c => expCatStore.add({name: c}));
            const settingsStore = tx.objectStore("settings"); settingsStore.clear(); for (const [key, value] of Object.entries(result.data.settings)) { settingsStore.add({ key: key, value: value }); }
            if (result.data.authStatuses) processVoidApprovals(result.data.authStatuses);

            globalMenuData = result.data.menu; activeLaundryTickets = result.data.activeLaundryOrders || [];
            let cItem = globalMenuData.find(i => String(i.category).toLowerCase().includes("coin") || String(i.name).toLowerCase().includes("koin")); if(cItem) activeCoinPrice = cItem.price;

            if(document.getElementById("ticket-count")) document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
            if(netText1) netText1.innerText = "Online & Sinkron"; if(netText2) netText2.innerText = "Sistem Siap! Silakan Login";
            if(netDot1) netDot1.style.backgroundColor = "#2ecc71"; if(netDot2) netDot2.style.backgroundColor = "#2ecc71";
            
            if (!document.getElementById("pos-screen").classList.contains("hidden")) { loadMenuUI(); renderActiveTickets(); }
        } else { throw new Error(result.message); }
    } catch (e) { 
        if(netText1) netText1.innerText = "Gagal Sinkron"; if(netText2) netText2.innerText = "Gagal Terhubung ke Google Sheets"; 
        if(netDot1) netDot1.style.backgroundColor = "#e74c3c"; if(netDot2) netDot2.style.backgroundColor = "#e74c3c"; console.error("Sync Error:", e);
    }
}

function handleAutocomplete(e) {
    const val = e.target.value.toLowerCase().trim(); const resBox = document.getElementById("autocomplete-results");
    activeCustomerProfile = null; document.getElementById("promo-indicator").classList.add("hidden");
    db.transaction(["members"], "readonly").objectStore("members").getAll().onsuccess = (ev) => {
        let matches = ev.target.result; 
        if (val.length > 0) matches = matches.filter(m => String(m.phone).toLowerCase().includes(val) || String(m.name).toLowerCase().includes(val));
        matches.sort((a, b) => (b.spent || 0) - (a.spent || 0));

        if (matches.length > 0) {
            resBox.innerHTML = matches.map(m => `<div class="autocomplete-item" onclick="selectMember('${m.phone}')"><div class="autocomplete-phone">${m.phone}</div><div class="autocomplete-name">${m.name}</div></div>`).join("");
            resBox.classList.remove("hidden");
        } else { resBox.classList.add("hidden"); }
    };
}
document.getElementById("cust-phone").addEventListener("input", handleAutocomplete); document.getElementById("cust-name").addEventListener("input", handleAutocomplete);
document.getElementById("cust-phone").addEventListener("click", handleAutocomplete); document.getElementById("cust-name").addEventListener("click", handleAutocomplete);
document.getElementById("cust-phone").addEventListener("focus", handleAutocomplete); document.getElementById("cust-name").addEventListener("focus", handleAutocomplete);
document.addEventListener('click', (e) => { if(!e.target.closest('.autocomplete-wrapper') && e.target.id !== 'cust-phone' && e.target.id !== 'cust-name') { document.getElementById('autocomplete-results').classList.add('hidden'); } });

function saveMemberToDB(profile) {
    if(!profile.phone || profile.phone === "-") return; 
    db.transaction(["members"], "readwrite").objectStore("members").put(profile);
    db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").put(profile);
}

function openLotteryModal() {
    if (!activeCustomerProfile) return alert("Harap pilih profil pelanggan terlebih dahulu.");
    
    if (activeCustomerProfile.isNoWA) {
        return alert("⚠️ Pelanggan tanpa WhatsApp valid tidak dapat didaftarkan dalam program undian.");
    }

    const select = document.getElementById("lottery-select"); 
    select.innerHTML = '<option value="">-- Pilih Promo Undian --</option>';
    window.globalPromos.forEach(p => { if(p.weeklyQuota === 0 || p.usedQuota < p.weeklyQuota) { select.innerHTML += `<option value="${p.code}">${p.code} (${p.rewardItem})</option>`; } });
    document.getElementById("lottery-desc").innerHTML = "";
    document.getElementById("lottery-modal").classList.remove("hidden");
}

window.updateLotteryDesc = function() {
    let code = document.getElementById("lottery-select").value;
    let descDiv = document.getElementById("lottery-desc");
    if(!code) { descDiv.innerHTML = ""; return; }
    let promo = window.globalPromos.find(p => p.code === code);
    if(promo) {
        descDiv.innerHTML = `<div style="padding:10px; background:#e8f4f8; border-radius:6px; color:#2980b9; font-weight:bold; margin-bottom:15px; text-align:left;">🎁 <strong>Insentif:</strong> Mendapatkan ${promo.rewardQty}x ${promo.rewardItem}</div>`;
    }
};

async function submitLotteryCode() {
    if (!activeCustomerProfile) return alert("Pilih pelanggan terlebih dahulu!");
    let code = document.getElementById("lottery-select").value;
    if (!code) return alert("Silakan pilih salah satu promo dari kotak dropdown!");

    let d = new Date();
    let todayStr = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0') + "-" + String(d.getDate()).padStart(2,'0');
    
    let hasPending = await new Promise(resolve => {
        db.transaction(["promo_claims"], "readonly").objectStore("promo_claims").getAll().onsuccess = e => {
            let claims = e.target.result;
            let found = claims.some(c => c.phone === activeCustomerProfile.phone && String(c.timestamp).startsWith(todayStr) && c.code !== "Loyalty Claim");
            resolve(found);
        };
    });

    if (activeCustomerProfile.lastClaimDate === todayStr || hasPending) {
        document.getElementById("lottery-modal").classList.add("hidden");
        return alert("⚠️ Pelanggan ini sudah mengklaim undian hari ini. (Batas maksimal 1 klaim per hari)");
    }

    let promo = window.globalPromos.find(p => p.code === code);
    if (!promo) return alert("Promo tidak valid atau tidak ditemukan di sistem.");

    antreans[currentAntreanIndex].pendingPromoCode = code;
    document.getElementById("lottery-modal").classList.add("hidden");
    updatePromoIndicator();
}

function loadMenuUI() {
    const categories = [...new Set(globalMenuData.map(i => i.category))]; currentCategory = categories[0];
    const catContainer = document.getElementById("category-container"); catContainer.innerHTML = "";
    categories.forEach(cat => {
        const btn = document.createElement("button"); btn.className = `cat-btn ${cat === currentCategory ? "active" : ""}`; btn.innerText = cat;
        btn.onclick = () => { currentNormally I can help with things like this, but I don't seem to have access to that content. You can try again or ask me for something else.
