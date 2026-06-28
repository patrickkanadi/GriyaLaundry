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

let currentCashier = ""; 
let currentPin = ""; 
let currentShiftId = ""; 
let currentLoginTime = "";
let globalMenuData = []; 
let currentCategory = "";
let activeLaundryTickets = [];
let currentCart = []; 
let activeNumpadItem = null; 
let numpadValue = "0";
let activeSettlementTicket = null;
window.masterDrawerBalance = 0; 
let isLoggingOut = false;
let currentVoidTarget = { type: null, id: null };
let isMenuLocked = true; 
let isSyncing = false; 
let activeCustomerProfile = null; 
let activeCoinPrice = 10000;
window.loyaltyTarget = 10; 
window.globalPromos = [];
window.enableDrawerTracking = true;

let btDevice = null;
let btCharacteristic = null;
let printShiftOnLogout = false;
window.lastActivityWrite = Date.now(); // Track local write state throttle memory

// Fungsi Baru: Menyinkronkan status pembatalan (void) dari server ke database lokal IndexedDB
function processVoidApprovals(authStatuses) {
    if (!db || !authStatuses) return;
    
    // 1. Sinkronisasi status Void untuk Transaksi (Orders)
    if (authStatuses.orders) {
        for (const [orderId, info] of Object.entries(authStatuses.orders)) {
            db.transaction(["orders"], "readonly").objectStore("orders").get(orderId).onsuccess = (e) => {
                let order = e.target.result;
                if (order && order.orderStatus !== info.status) {
                    order.orderStatus = info.status;
                    order.voidAuth = info.auth;
                    let txUpdate = db.transaction(["orders"], "readwrite");
                    txUpdate.objectStore("orders").put(order);
                }
            };
        }
    }
    
    // 2. Sinkronisasi status Void untuk Pengeluaran Laci (Expenses)
    if (authStatuses.expenses) {
        for (const [expenseId, info] of Object.entries(authStatuses.expenses)) {
            db.transaction(["expenses"], "readonly").objectStore("expenses").get(expenseId).onsuccess = (e) => {
                let expense = e.target.result;
                if (expense && expense.status !== info.status) {
                    expense.status = info.status;
                    let txUpdate = db.transaction(["expenses"], "readwrite");
                    txUpdate.objectStore("expenses").put(expense);
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

function formatWIB(dateString) { 
    return new Date(dateString).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') + ' WIB'; 
}

function formatTimeOnlyWIB(dateString) { 
    return new Date(dateString).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false, hour: '2-digit', minute: '2-digit' }) + ' WIB'; 
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); 
    deferredPrompt = e; 
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
            if (!db.objectStoreNames.contains("promo_claims")) db.createObjectStore("promo_claims", { keyPath: "claimId" });
            if (!db.objectStoreNames.contains("phone_updates")) db.createObjectStore("phone_updates", { keyPath: "id" });
        };
        request.onsuccess = (e) => { 
            db = e.target.result; 
            db.onversionchange = () => { db.close(); window.location.reload(); }; 
            resolve(db); 
        };
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
    
    const CMD_INIT = "\x1B\x40"; const CMD_CENTER = "\x1B\x61\x01"; const CMD_LEFT = "\x1B\x61\x00";
    const CMD_BOLD_ON = "\x1B\x45\x01"; const CMD_BOLD_OFF = "\x1B\x45\x00";
    const CMD_BIG = "\x1B!\x11"; const CMD_NORMAL = "\x1B!\x00"; const CMD_CUT = "\x1D\x56\x41\x10";

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
    
    const CMD_INIT = "\x1B\x40"; const CMD_CENTER = "\x1B\x61\x01"; const CMD_LEFT = "\x1B\x61\x00";
    const CMD_BOLD_ON = "\x1B\x45\x01"; const CMD_BOLD_OFF = "\x1B\x45\x00";
    const CMD_BIG = "\x1B!\x11"; const CMD_NORMAL = "\x1B!\x00"; const CMD_CUT = "\x1D\x56\x41\x10";

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
                document.getElementById("login-screen").classList.add("hidden");
                document.getElementById("pos-screen").classList.remove("hidden");
                document.getElementById("display-cashier").innerText = currentCashier;
                document.getElementById("main-workspace-wrapper").classList.remove("hidden");
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
    document.getElementById("main-workspace-wrapper").classList.add("hidden");
    document.getElementById("active-tickets-workspace").classList.add("hidden");
    if (type === 'new') {
        document.getElementById("tab-new-order").classList.add("active");
        document.getElementById("main-workspace-wrapper").classList.remove("hidden");
    } else {
        document.getElementById("tab-active-tickets").classList.add("active");
        document.getElementById("active-tickets-workspace").classList.remove("hidden");
        renderActiveTickets(); 
    }
}

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
    document.getElementById("autocomplete-results").classList.add("hidden");
    renderCart();
};

function updatePromoIndicator() {
    if (!activeCustomerProfile) {
        document.getElementById("promo-indicator").classList.add("hidden");
        return; 
    }
    let promoText = "";
    if (activeCustomerProfile.freeCoins > 0) promoText += `🎁 ${activeCustomerProfile.freeCoins} Koin Gratis! `;
    promoText += `(Poin: ${activeCustomerProfile.points}/${window.loyaltyTarget})`;
    let storedCount = Object.values(activeCustomerProfile.storedRewards || {}).reduce((a,b)=>a+b,0);
    if (storedCount > 0) promoText += ` | <span style="cursor:pointer; text-decoration:underline; color:purple;" onclick="showStoredRewards()">🎫 ${storedCount} Undian Tersimpan</span>`;
    let pending = antreans[currentAntreanIndex].pendingPromoCode;
    if (pending) promoText += ` | ⏳ Menunggu Checkout: ${pending}`;
    document.getElementById("promo-indicator").innerHTML = promoText;
    document.getElementById("promo-indicator").classList.remove("hidden");
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
    document.getElementById("customer-input-section").classList.remove("hidden");
    document.getElementById("active-customer-banner").classList.add("hidden");
    document.getElementById("glass-overlay").style.opacity = "1";
    document.getElementById("glass-overlay").style.pointerEvents = "auto";
    document.getElementById("cust-phone").value = "";
    document.getElementById("cust-name").value = "";
    currentCart = []; 
    antreans[currentAntreanIndex].cart = [];
    antreans[currentAntreanIndex].profile = null;
    antreans[currentAntreanIndex].isLocked = true;
    antreans[currentAntreanIndex].phoneInput = "";
    antreans[currentAntreanIndex].nameInput = "";
    antreans[currentAntreanIndex].pendingPromoCode = null;
    renderCart();
    document.getElementById("promo-indicator").classList.add("hidden");
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
                } else { return; }
            } else { return; }
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
                    phone: phone, name: name, points: 0, freeCoins: 0, spent: 0, storedRewards: {}, lastClaimDate: "", isNoWA: phone.startsWith("999")
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
        document.getElementById("cust-phone").value = activeCustomerProfile.phone;
        document.getElementById("cust-name").value = activeCustomerProfile.name;
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

// BUG FIX 4: Menghapus batasan strict panjang nomor whatsapp (< 5 karakter)
function submitEditMember() {
    let oldPhone = document.getElementById("edit-old-phone").value.trim(); 
    let newPhone = document.getElementById("edit-new-phone").value.trim();
    
    if(!oldPhone) return alert("Nomor lama tidak boleh kosong.");
    if(!newPhone) return alert("Nomor baru tidak boleh kosong.");

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
    if (!navigator.onLine) return alert("Anda sedang offline!"); 
    document.getElementById("network-text").innerText = "Mengirim Data...";
    document.getElementById("network-dot").style.backgroundColor = "#f39c12"; 
    await runBackgroundSync();
    document.getElementById("network-text").innerText = "Menarik Data..."; 
    await syncMasterData(); 
    alert("Sinkronisasi Database Berhasil!");
}

async function syncMasterData() {
    let netText1 = document.getElementById("network-text"); let netText2 = document.getElementById("login-network-text");
    let netDot1 = document.getElementById("network-dot"); let netDot2 = document.getElementById("login-network-dot");

    if (!navigator.onLine) {
        if(netText1) netText1.innerText = "Mode Offline"; 
        if(netText2) netText2.innerText = "Mode Offline (Gagal Tarik PIN)";
        if(netDot1) netDot1.style.backgroundColor = "#e74c3c"; 
        if(netDot2) netDot2.style.backgroundColor = "#e74c3c"; 
        return;
    }
    
    if(netText1) netText1.innerText = "Sinkronisasi..."; 
    if(netText2) netText2.innerText = "Menarik Database...";
    if(netDot1) netDot1.style.backgroundColor = "#f39c12"; 
    if(netDot2) netDot2.style.backgroundColor = "#f39c12";

    try {
        const response = await fetch(API_URL, { method: 'GET', mode: 'cors', redirect: 'follow' }); 
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        
        if (result.status === "Success") {
            window.masterDrawerBalance = result.masterDrawerBalance || 0;
            window.loyaltyTarget = result.data.loyaltyTarget || 10; 
            window.globalPromos = result.data.promos || [];
            
            // BUG FIX 1: Menyimpan riwayat shift online terpusat dari server sheet
            window.globalRecentShifts = result.recentShifts || result.data.recentShifts || [];
            
            window.enableDrawerTracking = String(result.data.settings["Enable_Drawer_Tracking"]).toUpperCase() !== "FALSE";
            const btnDrawer = document.getElementById("btn-drawer"); 
            if (btnDrawer) btnDrawer.style.display = window.enableDrawerTracking ? "" : "none";
            
            const tx = db.transaction(["staff", "menu", "settings", "members", "expense_categories"], "readwrite");
            tx.onerror = (event) => { console.error("Database Transaction Error:", event.target.error); };

            const staffStore = tx.objectStore("staff"); staffStore.clear(); result.data.staff.forEach(s => staffStore.add(s));
            const menuStore = tx.objectStore("menu"); menuStore.clear(); result.data.menu.forEach(m => menuStore.add(m));
            const memStore = tx.objectStore("members"); memStore.clear(); result.data.members.forEach(m => memStore.add(m));
            
            const expCatStore = tx.objectStore("expense_categories");
            expCatStore.clear(); if(result.data.expenseCategories) result.data.expenseCategories.forEach(c => expCatStore.add({name: c}));
            
            const settingsStore = tx.objectStore("settings"); settingsStore.clear();
            for (const [key, value] of Object.entries(result.data.settings)) { settingsStore.add({ key: key, value: value }); }
            
            if (result.data.authStatuses) processVoidApprovals(result.data.authStatuses);

            globalMenuData = result.data.menu; 
            activeLaundryTickets = result.data.activeLaundryOrders || [];
            
            let cItem = globalMenuData.find(i => String(i.category).toLowerCase().includes("coin") || String(i.name).toLowerCase().includes("koin")); 
            if(cItem) activeCoinPrice = cItem.price;

            if(document.getElementById("ticket-count")) document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
            if(netText1) netText1.innerText = "Online & Sinkron"; 
            if(netText2) netText2.innerText = "Sistem Siap! Silakan Login";
            if(netDot1) netDot1.style.backgroundColor = "#2ecc71"; 
            if(netDot2) netDot2.style.backgroundColor = "#2ecc71";
            
            if (!document.getElementById("pos-screen").classList.contains("hidden")) { loadMenuUI(); renderActiveTickets(); }
        } else { throw new Error(result.message); }
    } catch (e) { 
        if(netText1) netText1.innerText = "Gagal Sinkron"; 
        if(netText2) netText2.innerText = "Gagal Terhubung ke Google Sheets"; 
        if(netDot1) netDot1.style.backgroundColor = "#e74c3c"; 
        if(netDot2) netDot2.style.backgroundColor = "#e74c3c"; 
        console.error("Sync Error:", e);
    }
}

function handleAutocomplete(e) {
    const val = e.target.value.toLowerCase().trim(); const resBox = document.getElementById("autocomplete-results");
    activeCustomerProfile = null;
    document.getElementById("promo-indicator").classList.add("hidden");
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
document.getElementById("cust-phone").addEventListener("input", handleAutocomplete);
document.getElementById("cust-name").addEventListener("input", handleAutocomplete);
document.getElementById("cust-phone").addEventListener("click", handleAutocomplete);
document.getElementById("cust-name").addEventListener("click", handleAutocomplete);
document.getElementById("cust-phone").addEventListener("focus", handleAutocomplete);
document.getElementById("cust-name").addEventListener("focus", handleAutocomplete);
document.addEventListener('click', (e) => { if(!e.target.closest('.autocomplete-wrapper') && e.target.id !== 'cust-phone' && e.target.id !== 'cust-name') { document.getElementById('autocomplete-results').classList.add('hidden'); } });

function saveMemberToDB(profile) {
    if(!profile.phone || profile.phone === "-") return; 
    db.transaction(["members"], "readwrite").objectStore("members").put(profile);
    db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").put(profile);
}

function openLotteryModal() {
    if (!activeCustomerProfile) return alert("Harap pilih profil pelanggan terlebih dahulu.");
    if (activeCustomerProfile.isNoWA) { return alert("⚠️ Pelanggan tanpa WhatsApp valid tidak dapat didaftarkan dalam program undian."); }

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
            let found = claims.some(c => c.phone === activeCustomerProfile.phone && String(c.timestamp).startsWith(todayStr));
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
    const catContainer = document.getElementById("category-container");
    catContainer.innerHTML = "";
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
        let stockHtml = item.trackStock ? `<div style="font-size:11px; font-weight:bold; color:#e67e22; margin-top:5px;">Stok: ${item.currentStock}</div>` : "";
        card.innerHTML = `<div><h4 style="margin-top:0; margin-bottom:5px;">${item.name}</h4>${stockHtml}</div> <div class="price-badge">Rp ${item.price.toLocaleString('id-ID')}</div>`;
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
    let finalQty = qty; const existing = currentCart.find(i => i.itemId === item.itemId);
    if (!existing && item.hasMoq && item.moqQty > 0 && finalQty < item.moqQty) { alert(`⚠️ Minimum Order (MOQ) untuk ${item.name} adalah ${item.moqQty}.\nJumlah otomatis disesuaikan.`); finalQty = item.moqQty; }
    if (existing) { existing.qty += finalQty; } else { currentCart.push({ ...item, qty: finalQty, originalPrice: item.price, expectedCoins: item.expectedCoins, hasMoq: item.hasMoq, moqQty: item.moqQty }); }
    renderCart();
}

window.updateCartItemQty = function(itemId, delta) {
    let existing = currentCart.find(i => i.itemId === itemId);
    if (existing) {
        existing.qty += delta;
        if (existing.hasMoq && existing.moqQty > 0) {
            if (existing.qty > 0 && existing.qty < existing.moqQty) {
                if (delta < 0) existing.qty = 0; else existing.qty = existing.moqQty; 
            }
        }
        if (existing.qty <= 0) { currentCart = currentCart.filter(i => i.itemId !== itemId); }
        renderCart();
    }
};

// SAFE CHECKING: Mengamankan pembaruan innerText kasir agar tidak melempar null-pointer exception
function renderCart() {
    const container = document.getElementById("cart-items"); container.innerHTML = ""; let total = 0;
    currentCart.forEach(item => {
        const lineTotal = item.qty * item.price; total += lineTotal; 
        const qtyDisplay = item.qty % 1 !== 0 ? item.qty.toFixed(2) : item.qty;
        
        container.innerHTML += `
        <div class="cart-item" style="display:flex; flex-direction:column; align-items:stretch; gap:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <div style="font-weight:bold;">${item.name}</div>
                <strong style="color:#2c3e50;">Rp ${lineTotal.toLocaleString('id-ID')}</strong>
            </div>
            <div style="display:flex; align-items:center; background:#ecf0f1; border-radius:6px; overflow:hidden; width:max-content; border:1px solid #bdc3c7;">
                <button onclick="updateCartItemQty('${item.itemId}', -1)" style="border:none; background:#e74c3c; color:white; width:35px; height:30px; cursor:pointer; font-weight:bold; font-size:16px;">-</button>
                <span style="width:45px; text-align:center; font-weight:bold; font-size:14px;">${qtyDisplay}</span>
                <button onclick="updateCartItemQty('${item.itemId}', 1)" style="border:none; background:#2ecc71; color:white; width:35px; height:30px; cursor:pointer; font-weight:bold; font-size:16px;">+</button>
            </div>
        </div>`;
    });
    
    let totalContainer = document.getElementById("cart-grand-total") || document.getElementById("cart-total");
    if (totalContainer) { totalContainer.innerText = `Rp ${total.toLocaleString('id-ID')}`; }
    window.cartSubtotal = total;
    window.cartGrandTotal = total;
}

function clearCart() { lockMenu(); }

function reviewOrder() {
    if (currentCart.length === 0) return alert("Keranjang masih kosong!");
    let promoHtml = "";
    if (activeCustomerProfile) {
        let cartCoins = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
        let availableFree = activeCustomerProfile.freeCoins || 0;
        let tempPoints = activeCustomerProfile.points || 0;
        let maxRedeemable = 0;
        
        for (let i = 0; i < cartCoins; i++) {
            if (availableFree > 0) { maxRedeemable++; availableFree--; } 
            else { 
                tempPoints++; 
                if (tempPoints >= window.loyaltyTarget) { availableFree++; tempPoints -= window.loyaltyTarget; } 
            }
        }

        if (maxRedeemable > 0) {
            promoHtml += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
               <div><strong style="color:#856404;">🎁 Koin Gratis (Loyalty)</strong><br><small style="color:#856404;">Bisa klaim: ${maxRedeemable} (Poin awal: ${activeCustomerProfile.points})</small></div>
               <input type="number" class="promo-input" data-type="loyalty" data-item="Koin_Fisik" data-price="${activeCoinPrice}" value="${maxRedeemable}" max="${maxRedeemable}" min="0" oninput="applyPromo()" style="width:70px; padding:8px; font-weight:bold; text-align:center;">
           </div>`;
        }

        if (activeCustomerProfile.storedRewards) {
            for (const [rewardName, qtyOwned] of Object.entries(activeCustomerProfile.storedRewards)) {
                if (qtyOwned > 0) {
                    let cartItem = currentCart.find(i => i.name === rewardName || i.subCategory === rewardName || i.category === rewardName);
                    if (cartItem) {
                        promoHtml += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                           <div><strong style="color:#8e44ad;">🎫 Hadiah Undian: ${rewardName}</strong><br><small style="color:#8e44ad;">Berlaku untuk: ${cartItem.name} (Tersedia: ${qtyOwned})</small></div>
                           <input type="number" class="promo-input" data-type="stored" data-item="${rewardName}" data-price="${cartItem.originalPrice}" value="0" max="${Math.min(qtyOwned, cartItem.qty)}" min="0" oninput="applyPromo()" style="width:70px; padding:8px; font-weight:bold; text-align:center; border: 2px solid #9b59b6;">
                       </div>`;
                    }
                }
            }
        }
    }

    let promoContainer = document.getElementById("dynamic-promo-section") || document.getElementById("review-promo-section");
    if (promoContainer) {
        if (promoHtml) { promoContainer.innerHTML = promoHtml; promoContainer.classList.remove("hidden"); } 
        else { promoContainer.classList.add("hidden"); }
    }
 
    document.getElementById("pay-cash").value = 0; document.getElementById("pay-qris").value = 0; document.getElementById("pay-transfer").value = 0;
    document.getElementById("pay-hotel-piutang").value = 0; document.getElementById("pay-tamu-piutang").value = 0; document.getElementById("pay-free").value = 0;
    
    let internalCoinBox = document.getElementById("internal-coins"); if(internalCoinBox) internalCoinBox.value = 0;
    window.cartGrandTotal = window.cartSubtotal; 
    
    document.getElementById("review-subtotal").innerText = `Rp ${window.cartSubtotal.toLocaleString('id-ID')}`;
    document.getElementById("review-grandtotal").innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    
    applyPromo();
    document.getElementById("review-modal").classList.remove("hidden");
}

// ALIASING: Mengantisipasi perbedaan fungsi pemicu modal checkout (reviewOrder vs openReview)
window.openReview = reviewOrder;

// BUG FIX 2: Pembetulan kalkulasi grand total bersih setelah pengurangan diskon hemat
window.applyPromo = function() {
    let totalFreeValue = 0;
    document.querySelectorAll('.promo-input').forEach(input => {
        let max = Number(input.max) || 0; let val = Number(input.value) || 0;
        if (val > max) { val = max; input.value = val; } if (val < 0) { val = 0; input.value = 0; }
        let price = Number(input.getAttribute('data-price')) || 0;
        totalFreeValue += (val * price);
    });
 
    document.getElementById("pay-free").value = totalFreeValue; 
    let q = Number(document.getElementById("pay-qris").value) || 0; 
    let t = Number(document.getElementById("pay-transfer").value) || 0; 
    let hp = Number(document.getElementById("pay-hotel-piutang").value) || 0; 
    let tp = Number(document.getElementById("pay-tamu-piutang").value) || 0;
    
    // Potong langsung dari subtotal awal kasir
    window.cartGrandTotal = window.cartSubtotal - totalFreeValue;
    document.getElementById("review-grandtotal").innerText = `Rp ${window.cartGrandTotal.toLocaleString('id-ID')}`;
    
    let autoCash = window.cartGrandTotal - (q + t + hp + tp);
    document.getElementById("pay-cash").value = Math.max(0, autoCash); 
    calculateRemaining();
};

window.calculateRemaining = function() {
    const c = Number(document.getElementById("pay-cash").value) || 0; 
    const q = Number(document.getElementById("pay-qris").value) || 0; 
    const t = Number(document.getElementById("pay-transfer").value) || 0; 
    const hp = Number(document.getElementById("pay-hotel-piutang").value) || 0; 
    const tp = Number(document.getElementById("pay-tamu-piutang").value) || 0; 
    
    const totalAccounted = c + q + t + hp + tp; 
    const remaining = Math.max(0, window.cartGrandTotal - totalAccounted);
    document.getElementById("review-remaining").innerText = `Rp ${remaining.toLocaleString('id-ID')}`;
};

function closeReview() { document.getElementById("review-modal").classList.add("hidden"); }

async function finalizeOrder(shouldPrint) {
    const cash = Number(document.getElementById("pay-cash").value) || 0; 
    const qris = Number(document.getElementById("pay-qris").value) || 0; 
    const transfer = Number(document.getElementById("pay-transfer").value) || 0; 
    const hotelPiutang = Number(document.getElementById("pay-hotel-piutang").value) || 0; 
    const tamuPiutang = Number(document.getElementById("pay-tamu-piutang").value) || 0; 
    const free = Number(document.getElementById("pay-free").value) || 0;
    
    let internalCoinBox = document.getElementById("internal-coins"); const internalCoins = internalCoinBox ? (Number(internalCoinBox.value) || 0) : 0;
    const totalPiutang = hotelPiutang + tamuPiutang; 
    const totalAccounted = cash + qris + transfer + totalPiutang; 
    const remaining = window.cartGrandTotal - totalAccounted;
    const requiresProcessing = currentCart.some(i => String(i.workflow).toUpperCase() === "TICKET");
    
    let custPhoneRaw = document.getElementById("cust-phone").value.trim(); let custPhone = custPhoneRaw || "-";
    const custName = document.getElementById("cust-name").value.trim() || "Walk-in";
    const hasHotelItem = currentCart.some(i => String(i.category).toLowerCase().includes("hotel"));
 
    if (remaining > 0) return alert("⚠️ PEMBAYARAN DITOLAK:\nSisa Kurang Bayar harus Rp 0.");
    if (totalPiutang > 0 && !requiresProcessing) return alert("⚠️ PEMBAYARAN DITOLAK:\nPiutang HANYA berlaku untuk Tiket Drop-off.");
    if (totalPiutang > 0 && !hasHotelItem) return alert("⚠️ PEMBAYARAN DITOLAK:\nPiutang HANYA berlaku untuk item dalam kategori Hotel.");
    if (totalPiutang > 0 && (!custPhone || custPhone === "-")) return alert("⚠️ PEMBAYARAN DITOLAK:\nAnda WAJIB memasukkan nomor pelanggan untuk mencatat Piutang.");
 
    let payMethods = []; 
    if(cash > 0) payMethods.push("Tunai"); if(qris > 0) payMethods.push("QRIS"); if(transfer > 0) payMethods.push("Trf.Bank"); 
    if(hotelPiutang > 0) payMethods.push("Piutang(B2B)"); if(tamuPiutang > 0) payMethods.push("Piutang(Tamu)"); if(free > 0) payMethods.push("Gratis");
    
    const payString = payMethods.length > 0 ? payMethods.join("+") : "Belum Bayar";
    let status = "Completed"; 
    if (totalPiutang > 0) status = "Pending Debt"; else if (requiresProcessing) status = "Processing";
 
    let redeemedList = []; let redeemedLoyaltyCoins = 0;
    document.querySelectorAll('.promo-input').forEach(input => {
        let val = Number(input.value) || 0;
        if (val > 0) {
            let src = input.getAttribute('data-type');
            redeemedList.push({ source: src, item: input.getAttribute('data-item'), qty: val, price: Number(input.getAttribute('data-price')) });
            if (src === 'loyalty') redeemedLoyaltyCoins += val;
        }
    });
 
    let totalCoinsInCart = currentCart.filter(i => String(i.category).toLowerCase().includes('coin') || String(i.name).toLowerCase().includes('koin')).reduce((sum, i) => sum + i.qty, 0);
    let coinsEarned = Math.max(0, totalCoinsInCart - redeemedLoyaltyCoins);
    let newPoints = 0; let newFree = 0;
     
    if (custPhone !== "-") {
        if (!activeCustomerProfile) activeCustomerProfile = { phone: custPhone, name: custName, points: 0, freeCoins: 0, spent: 0, storedRewards: {}, lastClaimDate: "", isNoWA: custPhone.startsWith("999") };
        activeCustomerProfile.spent += window.cartGrandTotal;
        let currentPoints = activeCustomerProfile.points || 0; let currentFree = activeCustomerProfile.freeCoins || 0;
         
        currentFree -= redeemedLoyaltyCoins; currentPoints += coinsEarned;
        let newlyEarnedFree = Math.floor(currentPoints / window.loyaltyTarget);
        currentPoints = currentPoints % window.loyaltyTarget; currentFree += newlyEarnedFree;
        newPoints = currentPoints; newFree = currentFree;
         
        activeCustomerProfile.points = currentPoints; activeCustomerProfile.freeCoins = currentFree;
        redeemedList.forEach(rp => { if(rp.source === 'stored' && activeCustomerProfile.storedRewards[rp.item]) activeCustomerProfile.storedRewards[rp.item] -= rp.qty; });
         
        let pendingPromoCode = antreans[currentAntreanIndex].pendingPromoCode;
        if (pendingPromoCode) {
            let promo = window.globalPromos.find(p => p.code === pendingPromoCode);
            if (promo) {
                activeCustomerProfile.storedRewards[promo.rewardItem] = (activeCustomerProfile.storedRewards[promo.rewardItem] || 0) + promo.rewardQty;
                let d = new Date();
                let todayStr = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,'0') + "-" + String(d.getDate()).padStart(2,'0');
                activeCustomerProfile.lastClaimDate = todayStr; 
                 
                db.transaction(["promo_claims"], "readwrite").objectStore("promo_claims").add({
                    claimId: "CLM-" + Date.now(), timestamp: todayStr + "T" + d.toLocaleTimeString('en-GB'), phone: activeCustomerProfile.phone, code: pendingPromoCode, rewardItem: promo.rewardItem, rewardQty: promo.rewardQty, cashier: currentCashier, shiftId: currentShiftId, syncStatus: "Pending"
                });
            }
        }
        antreans[currentAntreanIndex].pendingPromoCode = null;
        saveMemberToDB(activeCustomerProfile);
    }
 
    let expectedCoinsTotal = currentCart.reduce((sum, item) => { let divisor = (item.hasMoq && item.moqQty > 0) ? item.moqQty : 1; let multiplier = Math.ceil(item.qty / divisor); return sum + ((item.expectedCoins || 0) * multiplier); }, 0);
 
    const orderPayload = {
        orderId: "ORD-" + Date.now(), timestamp: new Date().toISOString(), cashier: currentCashier, shiftId: currentShiftId,
        customerName: custName, customerPhone: custPhone, orderStatus: status, items: currentCart, subtotal: window.cartSubtotal, discounts: free, grandTotal: window.cartGrandTotal,
        paymentMethod: payString, cashAmount: cash, qrisAmount: qris, transferAmount: transfer, hotelPiutangAmount: hotelPiutang, tamuPiutangAmount: tamuPiutang, freeAmount: free, remainingDue: 0,
        coinsEarned: coinsEarned, redeemedPromos: redeemedList, expectedCoins: expectedCoinsTotal, internalCoinsUsed: internalCoins, syncStatus: "Pending" 
    };
 
    const txMenu = db.transaction(["menu"], "readwrite").objectStore("menu");
    currentCart.forEach(cartItem => {
        txMenu.get(cartItem.itemId).onsuccess = (ev) => {
            const menuItem = ev.target.result;
            if (menuItem && menuItem.trackStock) { menuItem.currentStock = Math.max(0, menuItem.currentStock - cartItem.qty); txMenu.put(menuItem); }
        };
    });
 
    if (internalCoins > 0) {
        txMenu.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (cursor) { if (String(cursor.value.name).toLowerCase() === "koin_fisik") { const updated = cursor.value; updated.currentStock = Math.max(0, updated.currentStock - internalCoins); cursor.update(updated); } cursor.continue(); }
        };
    }
 
    db.transaction(["orders"], "readwrite").objectStore("orders").add(orderPayload);
    if (requiresProcessing) { activeLaundryTickets.unshift(orderPayload); document.getElementById("ticket-count").innerText = activeLaundryTickets.length; }
     
    if (shouldPrint) { await buildEscPosReceipt(orderPayload.orderId, orderPayload, (cash + qris + transfer + free + totalPiutang), 0, payString, newPoints, newFree); }
    closeReview(); lockMenu(); renderProductGrid(); runBackgroundSync();
}

window.viewOrderDetails = function(orderId) {
    db.transaction(["orders"], "readonly").objectStore("orders").get(orderId).onsuccess = (e) => {
        let order = e.target.result;
        if(!order) return alert("Order tidak ditemukan di memori tablet.");
        
        let itemsHtml = "";
        let remainingPromos = [...(order.redeemedPromos || []).map(p => ({...p}))];
        
        order.items.forEach(item => {
            let lineTotal = item.qty * item.originalPrice;
            itemsHtml += `<div style="display:flex; justify-content:space-between; margin-top:8px;">
               <div style="font-weight:bold;">${item.qty}x ${item.name}</div>
               <div style="font-weight:bold;">Rp ${lineTotal.toLocaleString('id-ID')}</div>
           </div>`;
            
            for (let i = 0; i < remainingPromos.length; i++) {
                let rp = remainingPromos[i];
                if (rp.qty > 0 && (rp.item === item.name || rp.item === item.subCategory || rp.item === item.category)) {
                    let applyQty = Math.min(rp.qty, item.qty);
                    if (applyQty > 0) {
                        let discountValue = applyQty * rp.price;
                        itemsHtml += `<div style="display:flex; justify-content:space-between; font-size:13px; color:#e74c3c; margin-left:15px; border-bottom:1px dashed #eee; padding-bottom:4px;">
                           <div>↘ Promo Hemat! (${rp.item})</div>
                           <div>-Rp ${discountValue.toLocaleString('id-ID')}</div>
                       </div>`;
                        rp.qty -= applyQty;
                    }
                }
            }
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
                await buildEscPosReceipt(order.orderId + " (COPY)", order, deposit, 0, order.paymentMethod, pts, fre);
            };
        } else { await buildEscPosReceipt(order.orderId + " (COPY)", order, deposit, 0, order.paymentMethod, 0, 0); }
    };
};

// BUG FIX 1: Pencarian data terpusat di modal rincian shift online
window.viewShiftDetails = function(shiftId) {
    const onlineShift = (window.globalRecentShifts || []).find(s => s.shiftId === shiftId);
    if (onlineShift) {
        showShiftModalLayout(onlineShift);
    } else {
        db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").get(shiftId).onsuccess = (e) => {
            let s = e.target.result;
            if (!s) return alert("Data riwayat shift tidak ditemukan.");
            showShiftModalLayout(s);
        };
    }
};

function showShiftModalLayout(s) {
    let foodHtml = "";
    if(s.foodSummary) {
        for(const [name, qty] of Object.entries(s.foodSummary)) { 
            foodHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #eee; padding:4px 0;"><span>${name}</span> <strong>${qty}x</strong></div>`; 
        }
    }
    document.getElementById("sd-id").innerText = s.shiftId;
    document.getElementById("sd-login").innerText = formatTimeOnlyWIB(s.loginTime);
    document.getElementById("sd-logout").innerText = formatTimeOnlyWIB(s.logoutTime);
    document.getElementById("sd-omset").innerText = `Rp ${(s.totalOmset||0).toLocaleString('id-ID')}`;
    document.getElementById("sd-cash").innerText = `Rp ${(s.totalCash||0).toLocaleString('id-ID')}`;
    document.getElementById("sd-qris").innerText = `Rp ${(s.totalQris||0).toLocaleString('id-ID')}`;
    document.getElementById("sd-transfer").innerText = `Rp ${(s.totalTransfer||0).toLocaleString('id-ID')}`;
    document.getElementById("sd-net").innerText = `Rp ${(s.netCash||0).toLocaleString('id-ID')}`;
    document.getElementById("sd-food").innerHTML = foodHtml || "Tidak ada item terjual";
    document.getElementById("shift-detail-modal").classList.remove("hidden");
}

// BUG FIX 1: Dukungan cetak ulang struk dari riwayat online/Cloud Sheet
window.printShiftReportFromHistory = async function(shiftId) {
    if (!btCharacteristic) return alert("Printer belum terhubung! Silakan hubungkan dari menu atas.");
    const onlineShift = (window.globalRecentShifts || []).find(s => s.shiftId === shiftId);
    if (onlineShift) {
        await buildShiftReportReceipt(onlineShift);
    } else {
        db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").get(shiftId).onsuccess = async (e) => {
            let shiftData = e.target.result;
            if (!shiftData) return alert("Data laporan shift ini tidak ditemukan di memori lokal tablet ini.");
            await buildShiftReportReceipt(shiftData);
        };
    }
};

async function printCurrentShiftReport() {
    if (!btCharacteristic) return alert("Printer belum terhubung! Silakan hubungkan dari menu atas.");
    const data = window.currentShiftData;
    if (!data) return alert("Data ringkasan shift tidak tersedia.");
    
    const meterT = Number(document.getElementById("meter-token").value) || 0;
    const meterP = Number(document.getElementById("meter-pasca").value) || 0;
    
    const tempPayload = {
        shiftId: currentShiftId, cashier: currentCashier, loginTime: currentLoginTime, logoutTime: new Date().toISOString(),
        totalCustomers: data.totalCustomers, totalOrders: data.totalOrders, totalOmset: data.totalOmset, totalCash: data.totalCash, totalQris: data.totalQris, totalTransfer: data.totalTransfer, totalHotelPiutang: data.totalHotelPiutang, totalTamuPiutang: data.totalTamuPiutang, totalFree: data.totalFree,
        totalExpenses: data.totalExpenses, netCash: data.net, foodSummary: data.foodSummary, meterToken: meterT, meterPasca: meterP
    };
    try {
        await buildShiftReportReceipt(tempPayload);
        alert("Laporan berhasil dikirim ke printer!");
    } catch(e) { alert("Gagal mencetak: " + e.toString()); }
}

function renderActiveTickets() {
    const grid = document.getElementById("ticket-grid-container"); grid.innerHTML = "";
    activeLaundryTickets.forEach((ticket) => {
        const isReady = ticket.orderStatus === "Ready for Pickup";
        const totalPaid = (ticket.cashAmount||0) + (ticket.qrisAmount||0) + (ticket.transferAmount||0) + (ticket.freeAmount||0);
        const remaining = ticket.grandTotal - totalPaid;

        let receiptText = ticket.readableReceipt || "";
        if (!receiptText && ticket.items) receiptText = ticket.items.map(i => `${i.qty % 1 !== 0 ? i.qty.toFixed(2) : i.qty}x ${i.name}`).join('\n');

        let buttonsHtml = "";
        if (!isReady) { buttonsHtml = `<button class="ticket-btn" style="background:#f39c12;" onclick="markTicketReady('${ticket.orderId}', ${ticket.expectedCoins || 0})">Tandai Selesai Cuci</button>`; } 
        else { buttonsHtml = `<button class="ticket-btn" style="background:#2ecc71;" onclick="openSettlement('${ticket.orderId}', ${remaining})">Ambil Cucian & Bayar</button>`; }

        grid.innerHTML += `
            <div class="ticket-card ${isReady ? 'ready' : ''}">
                <div class="ticket-header"><span>${ticket.customerName}</span> <span style="color:#7f8c8d; font-size:12px;">${ticket.orderId}</span></div>
                <div style="font-size:14px; margin-bottom:10px; white-space:pre-wrap;">${receiptText}</div>
                <div style="display:flex; justify-content:space-between; font-size:14px; margin-bottom:10px; border-top:1px dashed #ddd; padding-top:5px;"><span>Piutang / Sisa:</span> <strong style="color:#e74c3c;">Rp ${remaining.toLocaleString('id-ID')}</strong></div>
                ${buttonsHtml}
            </div>
        `;
    });
}

let activeDoneOrderId = null;
function markTicketReady(orderId, expectedCoins) {
    activeDoneOrderId = orderId; document.getElementById("done-expected-coins").innerText = expectedCoins;
    document.getElementById("done-actual-coins").value = expectedCoins;
    document.getElementById("ticket-done-modal").classList.remove("hidden");
}

function submitTicketDone() {
    let actual = Number(document.getElementById("done-actual-coins").value) || 0;
    let expected = Number(document.getElementById("done-expected-coins").innerText) || 0;
    if (actual < 0) return alert("Jumlah koin tidak valid.");

    const ticket = activeLaundryTickets.find(t => t.orderId === activeDoneOrderId);
    if (ticket) {
        ticket.orderStatus = "Ready for Pickup"; ticket.syncStatus = "Pending";
        db.transaction(["orders"], "readwrite").objectStore("orders").put(ticket);

        if (actual > 0) {
            let overuse = Math.max(0, actual - expected); let baseUsage = Math.min(expected, actual);
            const payload = { logId: "TKC-" + Date.now(), orderId: activeDoneOrderId, timestamp: new Date().toISOString(), cashier: currentCashier, expected: baseUsage, overuse: overuse, syncStatus: "Pending" };
            db.transaction(["ticket_coins"], "readwrite").objectStore("ticket_coins").add(payload);
        }
        renderActiveTickets(); runBackgroundSync();
    }
    document.getElementById("ticket-done-modal").classList.add("hidden");
}

function openSettlement(orderId, remainingDue) {
    activeSettlementTicket = activeLaundryTickets.find(t => t.orderId === orderId);
    document.getElementById("settle-amount").innerText = `Rp ${remainingDue.toLocaleString('id-ID')}`;
    document.getElementById("settle-cash").value = remainingDue;
    document.getElementById("settle-qris").value = 0;
    document.getElementById("settle-transfer").value = 0;
    document.getElementById("settlement-modal").classList.remove("hidden");
}

function confirmSettlement() {
    if (!activeSettlementTicket) return;
    const c = Number(document.getElementById("settle-cash").value) || 0; const q = Number(document.getElementById("settle-qris").value) || 0; const t = Number(document.getElementById("settle-transfer").value) || 0;
    activeSettlementTicket.cashAmount += c;
    activeSettlementTicket.qrisAmount += q; activeSettlementTicket.transferAmount += t;
    activeSettlementTicket.orderStatus = "Completed";
    activeSettlementTicket.syncStatus = "Pending";
    db.transaction(["orders"], "readwrite").objectStore("orders").put(activeSettlementTicket);
    activeLaundryTickets = activeLaundryTickets.filter(t => t.orderId !== activeSettlementTicket.orderId);
    document.getElementById("ticket-count").innerText = activeLaundryTickets.length;
    document.getElementById("settlement-modal").classList.add("hidden");
    renderActiveTickets(); runBackgroundSync();
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
    document.getElementById("expense-modal").classList.add("hidden");
    document.getElementById("exp-amount").value = "";
    document.getElementById("exp-category").value = "";
    document.getElementById("exp-desc").value = "";
    alert("Pengeluaran Berhasil Dicatat!"); runBackgroundSync();
}

function openHistoryModal() { document.getElementById("history-modal").classList.remove("hidden"); renderHistoryList('orders'); }

// BUG FIX 1: Sinkronisasi Tampilan Riwayat Shift (Prioritas data online, dibatasi maksimal 5-6 data kasir aktif)
function renderHistoryList(type) {
    const container = document.getElementById("history-container"); container.innerHTML = "";
    if (type === 'orders') {
        db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
            const shiftOrders = e.target.result.filter(o => o.shiftId === currentShiftId).reverse(); 
            if(shiftOrders.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada order di shift ini.</div>`;
            shiftOrders.forEach(o => {
                let badge = o.orderStatus === "Voided" ? `<span class="status-badge status-voided">Dibatalkan</span>` : o.orderStatus === "Void Pending" ? `<span class="status-badge status-pending">Menunggu Admin</span>` : `<span class="status-badge status-paid">${o.orderStatus}</span>`; 
                let btn = (o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending") ? `<button onclick="requestVoid('orders', '${o.orderId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;" title="Batalkan Transaksi">Batal</button>` : '';
                let printBtn = `<button onclick="reprintOrder('${o.orderId}')" style="background:#3498db; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;" title="Cetak Ulang Nota">🖨️</button>`;
                let detailBtn = `<button onclick="viewOrderDetails('${o.orderId}')" style="background:#f39c12; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;" title="Lihat Detail Rincian">👁️ Detail</button>`;
                container.innerHTML += `<div class="history-row"><div><strong>${o.customerName}</strong><br><small style="color:#7f8c8d;">${formatTimeOnlyWIB(o.timestamp)} | Rp ${o.grandTotal.toLocaleString('id-ID')}</small></div><div style="display:flex; align-items:center; gap:8px;">${badge} ${detailBtn} ${printBtn} ${btn}</div></div>`;
            });
        };
    } else if (type === 'expenses') {
        db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = (e) => {
            const shiftExpenses = e.target.result.filter(exp => exp.shiftId === currentShiftId).reverse();
            if(shiftExpenses.length === 0) return container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada pengeluaran dicatat.</div>`;
            shiftExpenses.forEach(exp => {
                let badge = exp.status === "Voided" ? `<span class="status-badge status-voided">Dibatalkan</span>` : exp.status === "Void Pending" ? `<span class="status-badge status-pending">Menunggu Admin</span>` : `<span class="status-badge status-paid">Aktif</span>`;
                let btn = (exp.status !== "Voided" && exp.status !== "Void Pending") ? `<button onclick="requestVoid('expenses', '${exp.expenseId}')" style="background:#e74c3c; color:white; border:none; padding:5px 10px; border-radius:4px; cursor:pointer;">Batal</button>` : '';
                container.innerHTML += `<div class="history-row"><div><strong>${exp.category}</strong><br><small style="color:#7f8c8d;">${formatTimeOnlyWIB(exp.timestamp)} | Rp ${exp.amount.toLocaleString('id-ID')}</small><br><small>${exp.description}</small></div><div style="display:flex; align-items:center; gap:10px;">${badge} ${btn}</div></div>`;
            });
        };
    } else if (type === 'shifts') {
        const renderShiftsHTML = (shiftsData) => {
            const filtered = shiftsData.filter(s => s.cashier === currentCashier).slice(0, 6);
            if(filtered.length === 0) {
                container.innerHTML = `<div style="padding:20px; text-align:center;">Belum ada histori shift Anda di sistem.</div>`;
                return;
            }
            filtered.forEach(s => {
                let detailBtn = `<button onclick="viewShiftDetails('${s.shiftId}')" style="background:#f39c12; color:white; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; font-weight:bold; height:fit-content; margin-right:5px;">👁️ Detail</button>`;
                let printBtn = `<button onclick="printShiftReportFromHistory('${s.shiftId}')" style="background:#3498db; color:white; border:none; padding:8px 12px; border-radius:4px; cursor:pointer; font-weight:bold; height:fit-content;">🖨️ Cetak</button>`;
                container.innerHTML += `<div class="history-row" style="align-items:flex-start;"><div><strong>Shift: ${s.shiftId}</strong><br><small style="color:#7f8c8d;">Kasir: ${s.cashier} | Keluar: ${formatWIB(s.logoutTime)}</small></div><div style="display:flex; text-align:right; align-items:center;"><div><strong style="margin-right:15px;">Omset: Rp ${(s.totalOmset || 0).toLocaleString('id-ID')}</strong></div> ${detailBtn} ${printBtn}</div></div>`;
            });
        };

        if (window.globalRecentShifts && window.globalRecentShifts.length > 0) {
            renderShiftsHTML(window.globalRecentShifts);
        } else {
            db.transaction(["local_shift_history"], "readonly").objectStore("local_shift_history").getAll().onsuccess = (e) => {
                renderShiftsHTML(e.target.result.reverse());
            };
        }
    }
}

// PERBAIKAN: Mengubah tombol Shift untuk menampilkan ringkasan shift berjalan (bukan histori)
window.openShiftReport = function() {
    if (!db || !currentShiftId) {
        alert("⚠️ Anda belum masuk shift atau database belum siap.");
        return;
    }

    // Membuka koneksi baca ke store orders dan expenses
    let tx = db.transaction(["orders", "expenses"], "readonly");
    let ordersStore = tx.objectStore("orders");
    let expensesStore = tx.objectStore("expenses");

    let activeOrders = [];
    let activeExpenses = [];

    ordersStore.getAll().onsuccess = (ev) => { activeOrders = ev.target.result; };
    expensesStore.getAll().onsuccess = (ev) => { activeExpenses = ev.target.result; };

    // Setelah pengambilan data lokal selesai, lakukan kalkulasi real-time
    tx.oncomplete = () => {
        let shiftOrders = activeOrders.filter(o => o.shiftId === currentShiftId && o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending");
        let shiftExpenses = activeExpenses.filter(e => e.shiftId === currentShiftId && e.status === "Active");

        let totalCustomers = 0;
        let totalOrders = 0;
        let totalOmset = 0;
        let totalCash = 0;
        let totalQris = 0;
        let totalTransfer = 0;
        let totalHotelPiutang = 0;
        let totalTamuPiutang = 0;
        let totalFree = 0;
        let totalExpenses = 0;
        let foodSummary = {};

        // Iterasi kalkulasi breakdown pendapatan nota
        shiftOrders.forEach(o => {
            totalOrders++;
            if (o.customerPhone && o.customerPhone !== "-") totalCustomers++;
            totalOmset += (o.grandTotal || 0);
            totalCash += (o.cashAmount || 0);
            totalQris += (o.qrisAmount || 0);
            totalTransfer += (o.transferAmount || 0);
            totalHotelPiutang += (o.hotelPiutangAmount || 0);
            totalTamuPiutang += (o.tamuPiutangAmount || 0);
            totalFree += (o.freeAmount || 0);

            // Rekap item/layanan laundry yang terjual
            if (o.items) {
                o.items.forEach(i => {
                    if (!foodSummary[i.name]) foodSummary[i.name] = 0;
                    foodSummary[i.name] += i.qty;
                });
            }
        });

        // Iterasi rekap pengeluaran laci
        shiftExpenses.forEach(exp => { 
            tExpense += (exp.amount || 0); 
        });
        
        let netCash = Math.max(0, tCash - totalExpenses);

        // Kunci Data: Simpan hasil kalkulasi ke global memory agar dibaca sinkron oleh tombol cetak printer
        window.currentShiftData = {
            totalCustomers: totalCustomers,
            totalOrders: totalOrders,
            totalOmset: totalOmset,
            totalCash: totalCash,
            totalQris: totalQris,
            totalTransfer: totalTransfer,
            totalHotelPiutang: totalHotelPiutang,
            totalTamuPiutang: totalTamuPiutang,
            totalFree: totalFree,
            totalExpenses: totalExpenses,
            net: netCash,
            foodSummary: foodSummary
        };

        // Bangun elemen HTML daftar ringkasan item terjual
        let foodHtml = "";
        for (const [name, qty] of Object.entries(foodSummary)) {
            let qtyDisplay = qty % 1 !== 0 ? Number(qty).toFixed(2) : qty;
            foodHtml += `<div style="display:flex; justify-content:space-between; border-bottom:1px dashed #eee; padding:4px 0;"><span>${name}</span> <strong>${qtyDisplay}x</strong></div>`;
        }

        // Distribusikan data kalkulasi langsung ke elemen-elemen rincian penutupan modal di layar
        if (document.getElementById("sd-id")) document.getElementById("sd-id").innerText = currentShiftId;
        if (document.getElementById("sd-login")) document.getElementById("sd-login").innerText = formatTimeOnlyWIB(currentLoginTime);
        if (document.getElementById("sd-logout")) document.getElementById("sd-logout").innerText = "Saat Ini (Aktif)";
        if (document.getElementById("sd-omset")) document.getElementById("sd-omset").innerText = "Rp " + totalOmset.toLocaleString('id-ID');
        if (document.getElementById("sd-cash")) document.getElementById("sd-cash").innerText = "Rp " + totalCash.toLocaleString('id-ID');
        if (document.getElementById("sd-qris")) document.getElementById("sd-qris").innerText = "Rp " + totalQris.toLocaleString('id-ID');
        if (document.getElementById("sd-transfer")) document.getElementById("sd-transfer").innerText = "Rp " + totalTransfer.toLocaleString('id-ID');
        if (document.getElementById("sd-net")) document.getElementById("sd-net").innerText = "Rp " + netCash.toLocaleString('id-ID');
        if (document.getElementById("sd-food")) document.getElementById("sd-food").innerHTML = foodHtml || "Belum ada item terjual pada shift ini";

        // Tampilkan modal ringkasan shift penutupan ke kasir
        let modal = document.getElementById("shift-detail-modal");
        if (modal) {
            modal.classList.remove("hidden");
        } else {
            // Fallback jika id modal tidak ditemukan di index.html
            alert(`Ringkasan Shift Kasir:\n\nOmset: Rp ${totalOmset.toLocaleString('id-ID')}\nTunai: Rp ${totalCash.toLocaleString('id-ID')}\nQRIS: Rp ${totalQris.toLocaleString('id-ID')}\nTransfer: Rp ${totalTransfer.toLocaleString('id-ID')}\nPengeluaran Laci: Rp ${totalExpenses.toLocaleString('id-ID')}`);
        }
    };
};

// BUG FIX 3: Pengubahan ambang batas kedaluwarsa idle otomatis menjadi 4 jam (bebas logout jika baru 1 jam)
function checkExpiredShifts() {
    if (!db) return;
    db.transaction(["active_shifts"], "readonly").objectStore("active_shifts").getAll().onsuccess = (e) => {
        let activeShifts = e.target.result;
        let now = Date.now();
        activeShifts.forEach(shift => {
            let referenceTime = shift.lastActiveTime ? new Date(shift.lastActiveTime).getTime() : new Date(shift.loginTime).getTime();
            if (now - referenceTime > 4 * 60 * 60 * 1000) { performAutoClose(shift); }
        });
    };
}

function performAutoClose(shift) {
    let tCust = 0; let tOrders = 0; let tOmset = 0; let tCash = 0; let tQris = 0; let tTransfer = 0;
    let hPiu = 0; let tPiu = 0; let tFree = 0; let tExpense = 0; let foodSummary = {};
    db.transaction(["orders", "expenses"], "readonly").objectStore("orders").getAll().onsuccess = (e) => {
        const validOrders = e.target.result.filter(o => o.shiftId === shift.shiftId && o.orderStatus !== "Voided" && o.orderStatus !== "Void Pending");
        validOrders.forEach(o => {
            tOrders++; if(o.customerPhone && o.customerPhone !== "-") tCust++; tOmset += o.grandTotal;
            tCash += (o.cashAmount || 0); tQris += (o.qrisAmount || 0); tTransfer += (o.transferAmount || 0); 
            hPiu += (o.hotelPiutangAmount || 0); tPiu += (o.tamuPiutangAmount || 0); tFree += (o.freeAmount || 0); 
            if (o.items) o.items.forEach(i => { if(!foodSummary[i.name]) foodSummary[i.name] = 0; foodSummary[i.name] += i.qty; });
        });
        db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = (ex) => {
            const shiftExpenses = ex.target.result.filter(exp => exp.shiftId === shift.shiftId && exp.status === "Active"); 
            shiftExpenses.forEach(exp => { tExpense += (exp.amount || 0); });
            
            let netCash = Math.max(0, tCash - tExpense);
            const shiftPayload = {
                shiftId: shift.shiftId, timestamp: new Date().toISOString(), cashier: shift.cashierName || "System", loginTime: shift.loginTime, logoutTime: new Date().toISOString(), 
                totalCustomers: tCust, totalOrders: tOrders, totalOmset: tOmset, totalCash: tCash, totalQris: tQris, totalTransfer: tTransfer, totalHotelPiutang: hPiu, totalTamuPiutang: tPiu, totalFree: tFree,
                totalExpenses: tExpense, netCash: netCash, foodSummary: foodSummary, meterToken: 0, meterPasca: 0, closeNote: "System Auto-Closed (>4h Idle Expired)", syncStatus: "Pending"
            };

            let txW = db.transaction(["local_shift_history", "shift_reports", "active_shifts", "cash_drops"], "readwrite");
            txW.objectStore("local_shift_history").add(shiftPayload);
            txW.objectStore("shift_reports").add(shiftPayload);
            if (!window.enableDrawerTracking) {
                txW.objectStore("cash_drops").add({ dropId: "DRP-" + Date.now() + Math.floor(Math.random()*100), timestamp: new Date().toISOString(), cashier: shift.cashierName || "System", shiftId: shift.shiftId, toAdmin: netCash, toBank: 0, leftInDrawer: 0, notes: "[Ke Admin] Auto-Close Shift > 4 Jam", syncStatus: "Pending" });
            }
            txW.objectStore("active_shifts").delete(shift.pin);

            if (shift.shiftId === currentShiftId) {
                alert("⚠️ Shift Anda telah kadaluarsa karena tidak ada aktivitas selama 4 jam. Ditutup otomatis oleh sistem.");
                window.location.reload();
            }
        };
    };
}

function lockScreen() { window.location.reload(); }

async function runBackgroundSync() {
    if (!navigator.onLine || isSyncing) return;
    isSyncing = true; 
    try {
        let orders = await new Promise(res => db.transaction(["orders"], "readonly").objectStore("orders").getAll().onsuccess = e => res(e.target.result));
        for (const order of orders) {
            if (order.syncStatus === "Pending") {
                order.syncStatus = "Syncing"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order);
                try { 
                    let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "syncOrder", data: order }) }); 
                    if ((await r.json()).status === "Success") { order.syncStatus = "Synced"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); } 
                    else { order.syncStatus = "Pending"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); } 
                } catch(e) { order.syncStatus = "Pending"; db.transaction(["orders"], "readwrite").objectStore("orders").put(order); }
            }
        }
        
        let drops = await new Promise(res => db.transaction(["cash_drops"], "readonly").objectStore("cash_drops").getAll().onsuccess = e => res(e.target.result));
        for (const drop of drops) {
            if (drop.syncStatus === "Pending") { try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "syncCashDrop", data: drop }) }); if ((await r.json()).status === "Success") { drop.syncStatus = "Synced"; db.transaction(["cash_drops"], "readwrite").objectStore("cash_drops").put(drop); } } catch(e) {} }
        }
        
        let reports = await new Promise(res => db.transaction(["shift_reports"], "readonly").objectStore("shift_reports").getAll().onsuccess = e => res(e.target.result));
        for (const report of reports) {
            if (report.syncStatus === "Pending") { try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "syncShiftReport", data: report }) }); if ((await r.json()).status === "Success") { db.transaction(["shift_reports"], "readwrite").objectStore("shift_reports").delete(report.shiftId); } } catch(e) {} }
        }

        let expenses = await new Promise(res => db.transaction(["expenses"], "readonly").objectStore("expenses").getAll().onsuccess = e => res(e.target.result));
        for (const exp of expenses) {
            if (exp.syncStatus === "Pending") { try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "syncExpense", data: exp }) }); if ((await r.json()).status === "Success") { exp.syncStatus = "Synced"; db.transaction(["expenses"], "readwrite").objectStore("expenses").put(exp); } } catch(e) {} }
        }

        let voids = await new Promise(res => db.transaction(["void_requests"], "readonly").objectStore("void_requests").getAll().onsuccess = e => res(e.target.result));
        for (const req of voids) {
            try {
                const actionType = req.type === 'orders' ? "requestOrderVoid" : "requestExpenseVoid"; const payload = req.type === 'orders' ? { orderId: req.id, status: req.status, authName: req.authName } : { expenseId: req.id, status: req.status, authName: req.authName };
                let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: actionType, ...payload }) }); if ((await r.json()).status === "Success") { db.transaction(["void_requests"], "readwrite").objectStore("void_requests").delete(req.id); }
            } catch(e) {}
        }

        let members = await new Promise(res => db.transaction(["unsynced_members"], "readonly").objectStore("unsynced_members").getAll().onsuccess = e => res(e.target.result));
        for (const mem of members) {
            try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "syncMember", data: mem }) }); if ((await r.json()).status === "Success") { db.transaction(["unsynced_members"], "readwrite").objectStore("unsynced_members").delete(mem.phone); } } catch(e) {}
        }

        let phoneUpds = await new Promise(res => db.transaction(["phone_updates"], "readonly").objectStore("phone_updates").getAll().onsuccess = e => res(e.target.result));
        for (const upd of phoneUpds) {
            try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "updateMemberPhone", data: upd }) }); if ((await r.json()).status === "Success") { db.transaction(["phone_updates"], "readwrite").objectStore("phone_updates").delete(upd.id); } } catch(e) {}
        }
        
        let coinRets = await new Promise(res => db.transaction(["coin_retrievals"], "readonly").objectStore("coin_retrievals").getAll().onsuccess = e => res(e.target.result));
        for (const ret of coinRets) {
            if (ret.syncStatus === "Pending") {
                let actionCode = ret.notes && ret.notes.includes("Macet") ? "syncCoinJammed" : "syncCoinRetrieval";
                try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: actionCode, data: ret }) }); if ((await r.json()).status === "Success") { ret.syncStatus = "Synced"; db.transaction(["coin_retrievals"], "readwrite").objectStore("coin_retrievals").put(ret); } } catch(e) {} 
            }
        }

        let ticketCoins = await new Promise(res => db.transaction(["ticket_coins"], "readonly").objectStore("ticket_coins").getAll().onsuccess = e => res(e.target.result));
        for (const tc of ticketCoins) {
            if (tc.syncStatus === "Pending") {
                try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "syncTicketCoins", data: tc }) }); if ((await r.json()).status === "Success") { tc.syncStatus = "Synced"; db.transaction(["ticket_coins"], "readwrite").objectStore("ticket_coins").put(tc); } } catch(e) {}
            }
        }

        let promoClaims = await new Promise(res => db.transaction(["promo_claims"], "readonly").objectStore("promo_claims").getAll().onsuccess = e => res(e.target.result));
        for (const claim of promoClaims) {
            if (claim.syncStatus === "Pending") {
                try { let r = await fetch(API_URL, { method: 'POST', mode: 'cors', redirect: 'follow', body: JSON.stringify({ action: "syncPromoClaim", data: claim }) }); if ((await r.json()).status === "Success") { db.transaction(["promo_claims"], "readwrite").objectStore("promo_claims").delete(claim.claimId); } } catch(e) {} 
            }
        }
    } finally { isSyncing = false; }
}

window.onload = async () => { 
    await initDB(); 
    await syncMasterData(); 
    window.setInterval(runBackgroundSync, 5000); 
    window.setInterval(syncMasterData, 30000); 
    window.setInterval(checkExpiredShifts, 60000); 
    setTimeout(checkExpiredShifts, 3000); 
};
