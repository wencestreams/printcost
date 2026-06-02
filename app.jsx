const { useState, useEffect, useRef, useCallback } = React;

// ─── Firebase ──────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCNlpnZFXsZkcDvi4ccOL5tV3kE1S_SfhY",
  authDomain: "habit-tracker-claude-cc01a.firebaseapp.com",
  projectId: "habit-tracker-claude-cc01a",
  storageBucket: "habit-tracker-claude-cc01a.firebasestorage.app",
  messagingSenderId: "646881871024",
  appId: "1:646881871024:web:1414bf0db728ec7160a775",
};
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_CONFIG.projectId}/databases/(default)/documents/printcost`;

const fsGet = async (syncKey) => {
  try {
    const res = await fetch(`${FIRESTORE_URL}/${syncKey}?key=${FIREBASE_CONFIG.apiKey}`);
    if (!res.ok) return null;
    const doc = await res.json();
    const fields = doc.fields || {};
    const out = {};
    for (const [k, v] of Object.entries(fields)) out[k] = JSON.parse(v.stringValue);
    return out;
  } catch { return null; }
};

const fsSet = async (syncKey, data) => {
  try {
    const fields = {};
    for (const [k, v] of Object.entries(data)) fields[k] = { stringValue: JSON.stringify(v) };
    await fetch(`${FIRESTORE_URL}/${syncKey}?key=${FIREBASE_CONFIG.apiKey}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
  } catch {}
};

const genKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,"0")).join("");

// ─── localStorage helpers ──────────────────────────────────────────────────────
const lsGet = (key, fb) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const lsSet = (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} };

// ─── Helpers ───────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);
const TYPES = ["PLA","PETG","ABS","ASA","TPU","Nylon","Resin","Other"];
const TABS = ["Orders","Filaments","Models","Extras","Settings"];

const DEFAULT_SETTINGS = {
  cppm: 1, electricityPerMinute: 0.05, brandName: "", friendMode: false,
  lowStockGrams: 100, accentColor: "#7c3aed",
  invoiceMode: "simple", czechInvoice: false,
  supplierName: "", supplierAddress: "", supplierCity: "", supplierZip: "", supplierCountry: "Česká republika",
  supplierICO: "", supplierEmail: "", supplierPhone: "",
  bankAccount: "", bankIBAN: "", bankBIC: "",
  paymentDueDays: 14, invoiceCounter: 1,
  plasticTypes: ["PLA","PETG","ABS","ASA","TPU","Nylon","Resin","Other"],
};

const calcOrderTotal = (order, filaments, extras, settings) => {
  let t = 0;
  (order.items||[]).forEach(item => {
    const mult = 1 + (parseFloat(item.filamentMarkup)||0) / 100;
    (item.filamentUses||[]).forEach(fu => {
      const f = filaments.find(x => x.id === fu.filamentId);
      if (f) t += (parseFloat(fu.grams)||0) / 1000 * f.pricePerKg * mult;
    });
  });
  if (!settings.friendMode) {
    t += (parseFloat(order.printMinutes)||0) * (parseFloat(settings.cppm)||0);
    t += (parseFloat(order.electricityMinutes)||0) * (parseFloat(settings.electricityPerMinute)||0);
  }
  (order.extraLines||[]).forEach(el => {
    if (el.extraId) { const ex = extras.find(x => x.id === el.extraId); if (ex) t += (parseFloat(el.qty)||1) * (parseFloat(ex.unitPrice)||0); }
    else if (el.customName) t += (parseFloat(el.qty)||1) * (parseFloat(el.unitPrice)||0);
  });
  return t;
};

// ─── Export / Import ───────────────────────────────────────────────────────────
const exportData = (data, filename) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const importData = (file, cb) => {
  const r = new FileReader();
  r.onload = e => { try { cb(JSON.parse(e.target.result)); } catch { alert("Invalid file."); } };
  r.readAsText(file);
};

const fmtCZK = (val, czech) =>
  czech ? val.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0") + "\u00a0Kč"
        : val.toFixed(2) + " CZK";

// ─── Invoice ───────────────────────────────────────────────────────────────────
const exportInvoice = (order, filaments, extras, settings, invoiceNumber) => {
  const fm = settings.friendMode;
  const czech = settings.czechInvoice;
  const advanced = settings.invoiceMode === "advanced";
  const accent = settings.accentColor || "#7c3aed";
  const today = new Date();
  const fmt = d => d.toLocaleDateString(czech ? "cs-CZ" : "en-GB");
  const dueDate = new Date(today); dueDate.setDate(dueDate.getDate() + (parseInt(settings.paymentDueDays)||14));
  const L = czech ? {
    invoice:"FAKTURA",invoiceNum:"Číslo faktury",date:"Datum vystavení",due:"Datum splatnosti",
    vs:"Variabilní symbol",supplier:"Dodavatel",client:"Odběratel",ico:"IČO",email:"E-mail",phone:"Tel.",
    bank:"Bankovní spojení",iban:"IBAN",bic:"BIC/SWIFT",order:"Objednávka",models:"Modely",model:"Model",qty:"Ks",
    filaments:"Spotřeba materiálu",material:"Materiál",color:"Barva",weight:"Hmotnost",price:"Cena",
    otherCosts:"Ostatní náklady",item:"Položka",services:"Služby a příplatky",service:"Služba",
    subtotal:"Mezisoučet",total:"Celkem k úhradě",notice:"Nejsem plátce DPH.",footer:"Vystaveno pomocí PrintCost",
    printTime:(m)=>`Čas tisku (${m} min)`,elec:"Elektřina",
  } : {
    invoice:"INVOICE",invoiceNum:"Invoice No.",date:"Date",due:"Due Date",vs:"Variable Symbol",
    supplier:"Supplier",client:"Client",ico:"Business ID",email:"E-mail",phone:"Phone",
    bank:"Bank Account",iban:"IBAN",bic:"BIC/SWIFT",order:"Order",models:"Models",model:"Model",qty:"Qty",
    filaments:"Filament Costs",material:"Material",color:"Color",weight:"Weight",price:"Cost",
    otherCosts:"Other Costs",item:"Item",services:"Additional Services",service:"Service",
    subtotal:"Subtotal",total:"Total Due",notice:"Not a VAT payer.",footer:"Generated by PrintCost",
    printTime:(m)=>`Print time (${m} min)`,elec:"Electricity",
  };
  const f = v => fmtCZK(v, czech);
  let filRows="",filTotal=0;
  (order.items||[]).forEach(item => {
    const mult=1+(parseFloat(item.filamentMarkup)||0)/100;
    (item.filamentUses||[]).forEach(fu => {
      const fil=filaments.find(x=>x.id===fu.filamentId); if(!fil)return;
      const base=(parseFloat(fu.grams)||0)/1000*fil.pricePerKg;
      const cost=base*mult; filTotal+=cost;
      filRows+=`<tr><td>${fil.type}</td><td>${fil.color}</td><td>${fu.grams}g</td><td class="r">${f(cost)}</td></tr>`;
    });
  });
  let otherRows="",otherTotal=0;
  if(!fm){
    const pt=(parseFloat(order.printMinutes)||0)*(parseFloat(settings.cppm)||0);
    const el=(parseFloat(order.electricityMinutes)||0)*(parseFloat(settings.electricityPerMinute)||0);
    if(pt>0){otherRows+=`<tr><td colspan="3">${L.printTime(order.printMinutes)}</td><td class="r">${f(pt)}</td></tr>`;otherTotal+=pt;}
    if(el>0){otherRows+=`<tr><td colspan="3">${L.elec}</td><td class="r">${f(el)}</td></tr>`;otherTotal+=el;}
  }
  let extraRows="",extraTotal=0;
  (order.extraLines||[]).forEach(el=>{
    if(el.extraId){const ex=extras.find(x=>x.id===el.extraId);if(!ex)return;const cost=(parseFloat(el.qty)||1)*(parseFloat(ex.unitPrice)||0);extraTotal+=cost;extraRows+=`<tr><td>${ex.name}</td><td class="r">${el.qty||1}</td><td class="r">${f(parseFloat(ex.unitPrice)||0)}</td><td class="r">${f(cost)}</td></tr>`;}
    else if(el.customName){const cost=(parseFloat(el.qty)||1)*(parseFloat(el.unitPrice)||0);extraTotal+=cost;extraRows+=`<tr><td>${el.customName}</td><td class="r">${el.qty||1}</td><td class="r">${f(parseFloat(el.unitPrice)||0)}</td><td class="r">${f(cost)}</td></tr>`;}
  });
  const total=filTotal+otherTotal+extraTotal;
  const invNum=invoiceNumber||String(settings.invoiceCounter||1).padStart(6,"0");
  const advancedHeader=advanced?`
    <div class="two-col" style="margin-bottom:24px;gap:32px">
      <div class="info-box"><div class="box-title">${L.supplier}</div>
        <strong>${settings.supplierName||settings.brandName||""}</strong><br>
        ${settings.supplierAddress||""}<br>${settings.supplierZip||""} ${settings.supplierCity||""}<br>${settings.supplierCountry||""}
        ${settings.supplierICO?`<br>${L.ico}: <strong>${settings.supplierICO}</strong>`:""}
        ${settings.supplierEmail?`<br>${L.email}: ${settings.supplierEmail}`:""}
        ${settings.supplierPhone?`<br>${L.phone}: ${settings.supplierPhone}`:""}
      </div>
      <div class="info-box"><div class="box-title">${L.client}</div>
        <strong>${order.clientName||""}</strong><br>${order.clientAddress||""}<br>
        ${order.clientZip||""} ${order.clientCity||""}<br>${order.clientCountry||""}
        ${order.clientEmail?`<br>${L.email}: ${order.clientEmail}`:""}
      </div>
    </div>
    <div class="two-col" style="margin-bottom:24px;background:#f9f6ff;border-radius:8px;padding:12px 16px;border:1px solid ${accent}22">
      <div><span class="meta-label">${L.invoiceNum}</span><strong>${invNum}</strong></div>
      <div><span class="meta-label">${L.date}</span>${fmt(today)}</div>
      <div><span class="meta-label">${L.due}</span><strong>${fmt(dueDate)}</strong></div>
      ${settings.bankAccount?`<div><span class="meta-label">${L.vs}</span>${invNum}</div>`:""}
    </div>
    ${settings.bankAccount?`<div class="info-box" style="margin-bottom:24px;background:#f0faf4;border:1px solid #86efac44;border-radius:8px;padding:12px 16px">
      <div class="box-title" style="color:#166534">${L.bank}</div>
      ${settings.bankAccount?`<div>${L.bank}: <strong>${settings.bankAccount}</strong></div>`:""}
      ${settings.bankIBAN?`<div>${L.iban}: <strong>${settings.bankIBAN}</strong></div>`:""}
      ${settings.bankBIC?`<div>${L.bic}: ${settings.bankBIC}</div>`:""}
      <div>${L.vs}: <strong>${invNum}</strong></div>
    </div>`:""}`:""
  ;
  const html=`<!DOCTYPE html><html lang="${czech?"cs":"en"}"><head><meta charset="utf-8">
<title>${L.invoice} – ${order.name||"Order"}</title>
<style>*{box-sizing:border-box}body{font-family:Arial,sans-serif;max-width:820px;margin:40px auto;color:#222;font-size:13px;padding:0 24px;line-height:1.5}
h2{font-size:13px;border-bottom:2px solid ${accent};padding-bottom:4px;margin:24px 0 8px;color:${accent};text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse;margin-bottom:8px}th{background:#f4f4f4;text-align:left;padding:7px 10px;border:1px solid #ddd;font-size:12px}
td{padding:7px 10px;border:1px solid #ddd;font-size:12px}.r{text-align:right}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid ${accent}}
.brand{font-size:22px;font-weight:bold;color:${accent}}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.info-box{font-size:12px;line-height:1.8}.box-title{font-size:11px;font-weight:bold;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
.meta-label{display:block;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.05em;margin-bottom:1px}
.total-box{background:#f9f6ff;border:1px solid ${accent}33;border-radius:8px;padding:14px 18px;margin-top:20px}
.total-line{display:flex;justify-content:space-between;font-size:12px;color:#555;margin-bottom:5px}
.grand{display:flex;justify-content:space-between;font-size:18px;font-weight:bold;color:${accent};margin-top:10px;padding-top:10px;border-top:2px solid ${accent}44}
.notice{font-size:11px;color:#888;margin-top:20px;padding:8px 12px;background:#f5f5f5;border-radius:6px;border-left:3px solid ${accent}}
.footer{margin-top:40px;font-size:10px;color:#bbb;text-align:center;border-top:1px solid #eee;padding-top:12px}
@media print{body{margin:0}}</style></head><body>
<div class="header"><div><div class="brand">${settings.brandName||settings.supplierName||"3D Print Studio"}</div>
${!advanced&&settings.supplierICO?`<div style="font-size:11px;color:#888;margin-top:2px">${L.ico}: ${settings.supplierICO}</div>`:""}</div>
<div style="text-align:right"><div style="font-size:24px;font-weight:bold;color:${accent}">${L.invoice}</div>
${advanced?`<div style="font-size:12px;color:#888;margin-top:2px">${invNum}</div>`:`<div style="font-size:13px;font-weight:bold;color:${accent};margin-top:2px">${invNum}</div><div style="font-size:12px;color:#888;margin-top:2px">${fmt(today)}</div>`}</div></div>
${advanced?advancedHeader:`<div style="margin-bottom:16px"><div style="font-size:12px;color:#666">${L.date}: ${fmt(today)}</div></div>`}
${advanced?`<h2>${L.order}${order.name?`: ${order.name}`:""}</h2>`:(order.name?`<div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px">${L.invoiceNum}: ${invNum}</div><h2 style="margin:0 0 8px">${order.name}</h2>`:`<h2>${L.invoiceNum}: ${invNum}</h2>`)}
${order.description?`<p style="color:#555;font-size:12px;margin:0 0 12px">${order.description}</p>`:""}
<h2>${L.models}</h2><table><tr><th>${L.model}</th><th>${L.qty}</th></tr>
${(order.items||[]).map(i=>`<tr><td>${i.modelName||"Custom"}</td><td>${i.qty||1}</td></tr>`).join("")}</table>
<h2>${L.filaments}</h2><table><tr><th>${L.material}</th><th>${L.color}</th><th>${L.weight}</th><th class="r">${L.price}</th></tr>
${filRows||`<tr><td colspan="4" style="color:#aaa">—</td></tr>`}</table>
${otherRows?`<h2>${L.otherCosts}</h2><table><tr><th colspan="3">${L.item}</th><th class="r">${L.price}</th></tr>${otherRows}</table>`:""}
${extraRows?`<h2>${L.services}</h2><table><tr><th>${L.service}</th><th class="r">${L.qty}</th><th class="r">${L.price}</th><th class="r">${L.price}</th></tr>${extraRows}</table>`:""}
<div class="total-box">
<div class="total-line"><span>${L.filaments}</span><span>${f(filTotal)}</span></div>
${otherTotal>0?`<div class="total-line"><span>${L.otherCosts}</span><span>${f(otherTotal)}</span></div>`:""}
${extraTotal>0?`<div class="total-line"><span>${L.services}</span><span>${f(extraTotal)}</span></div>`:""}
<div class="grand"><span>${L.total}</span><span>${f(total)}</span></div></div>
${czech?`<div class="notice">${L.notice}</div>`:""}
<div class="footer">${L.footer}</div></body></html>`;
  const blob=new Blob([html],{type:"text/html;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;
  a.download=`faktura-${invNum}-${(order.name||"order").replace(/\s+/g,"-")}.html`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};

// ─── App ───────────────────────────────────────────────────────────────────────
function App() {
  const [tab, setTab] = useState("Orders");
  const [filaments, setFilaments] = useState(null);
  const [models, setModels] = useState(null);
  const [extras, setExtras] = useState(null);
  const [settings, setSettings] = useState(null);
  const [orders, setOrders] = useState(null);
  const [activeOrder, setActiveOrder] = useState(null);
  const [orderView, setOrderView] = useState("list");
  const [syncKey, setSyncKey] = useState(null);
  const [syncStatus, setSyncStatus] = useState("idle");
  const syncTimer = useRef(null);
  const stateRef = useRef({});
  const ready = [filaments,models,extras,settings,orders].every(x => x !== null);

  useEffect(() => {
    const f  = lsGet("fil2", []);
    const m  = lsGet("mod2", []);
    const ex = lsGet("ext1", []);
    const s  = lsGet("set2", DEFAULT_SETTINGS);
    const o  = lsGet("ord2", []);
    const sk = lsGet("syncKey", null);
    setFilaments(f); setModels(m); setExtras(ex);
    setSettings({...DEFAULT_SETTINGS,...s});
    setOrders(o); setSyncKey(sk);

    if (sk) {
      setSyncStatus("syncing");
      fsGet(sk).then(remote => {
        if (remote) {
          if (remote.filaments) { setFilaments(remote.filaments); lsSet("fil2", remote.filaments); }
          if (remote.models)    { setModels(remote.models);       lsSet("mod2", remote.models); }
          if (remote.extras)    { setExtras(remote.extras);       lsSet("ext1", remote.extras); }
          if (remote.orders)    { setOrders(remote.orders);       lsSet("ord2", remote.orders); }
          if (remote.settings)  { setSettings({...DEFAULT_SETTINGS,...remote.settings}); lsSet("set2", remote.settings); }
          setSyncStatus("ok");
        } else { setSyncStatus("error"); }
      });
    }
  }, []);

  useEffect(() => { stateRef.current = { filaments, models, extras, orders, settings }; }, [filaments, models, extras, orders, settings]);

  const persistAll = useCallback((newState) => {
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      lsSet("fil2", newState.filaments);
      lsSet("mod2", newState.models);
      lsSet("ext1", newState.extras);
      lsSet("ord2", newState.orders);
      lsSet("set2", newState.settings);
      const sk = lsGet("syncKey", null);
      if (sk) {
        setSyncStatus("syncing");
        try {
          await fsSet(sk, { filaments:newState.filaments, models:newState.models, extras:newState.extras, orders:newState.orders, settings:newState.settings });
          setSyncStatus("ok");
        } catch { setSyncStatus("error"); }
      }
    }, 800);
  }, []);

  const mkSetter = (setter, key) => v => {
    setter(prev => {
      const n = typeof v === "function" ? v(prev) : v;
      persistAll({ ...stateRef.current, [key]: n });
      return n;
    });
  };

  const setFil  = mkSetter(setFilaments, "filaments");
  const setMod  = mkSetter(setModels,    "models");
  const setEx   = mkSetter(setExtras,    "extras");
  const setSett = mkSetter(setSettings,  "settings");
  const setOrd  = mkSetter(setOrders,    "orders");

  const connectSync = async (key) => {
    const k = key.trim().replace(/-/g,"").toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(k)) { alert("Invalid key — must be 32 hex characters."); return; }
    setSyncStatus("syncing");
    const remote = await fsGet(k);
    if (remote && Object.keys(remote).length > 0) {
      if (remote.filaments) { setFilaments(remote.filaments); lsSet("fil2", remote.filaments); }
      if (remote.models)    { setModels(remote.models);       lsSet("mod2", remote.models); }
      if (remote.extras)    { setExtras(remote.extras);       lsSet("ext1", remote.extras); }
      if (remote.orders)    { setOrders(remote.orders);       lsSet("ord2", remote.orders); }
      if (remote.settings)  { setSettings({...DEFAULT_SETTINGS,...remote.settings}); lsSet("set2", remote.settings); }
      setSyncStatus("ok");
    } else {
      await fsSet(k, { filaments:stateRef.current.filaments||[], models:stateRef.current.models||[], extras:stateRef.current.extras||[], orders:stateRef.current.orders||[], settings:stateRef.current.settings||DEFAULT_SETTINGS });
      setSyncStatus("ok");
    }
    setSyncKey(k); lsSet("syncKey", k);
  };

  const disconnectSync = () => { setSyncKey(null); lsSet("syncKey", null); setSyncStatus("idle"); };
  const generateNewKey = () => connectSync(genKey());

  const accent = settings?.accentColor || "#7c3aed";
  if (!ready) return React.createElement("div", {style:{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0f0f13",color:"#888",fontFamily:"Inter,Arial,sans-serif"}},"Loading…");

  const statusDot = syncKey ? (syncStatus==="syncing"?"🔄":syncStatus==="ok"?"🟢":"🔴") : "⚪";

  return (
    <div style={{fontFamily:"Inter,Arial,sans-serif",background:"#0f0f13",minHeight:"100vh",color:"#e8e8f0"}}>
      <NavBar tab={tab} setTab={setTab} accent={accent} friendMode={settings.friendMode}
        toggleFriend={()=>setSett(s=>({...s,friendMode:!s.friendMode}))} syncDot={statusDot} onSyncTab={()=>setTab("Settings")}/>
      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 20px"}}>
        {tab==="Filaments" && <FilamentsTab filaments={filaments} setFilaments={setFil} settings={settings} accent={accent}/>}
        {tab==="Models"    && <ModelsTab models={models} setModels={setMod} accent={accent}/>}
        {tab==="Extras"    && <ExtrasTab extras={extras} setExtras={setEx} accent={accent}/>}
        {tab==="Settings"  && <SettingsTab settings={settings} setSettings={setSett} filaments={filaments} setFilaments={setFil} models={models} setModels={setMod} extras={extras} setExtras={setEx} orders={orders} setOrders={setOrd} accent={accent} syncKey={syncKey} syncStatus={syncStatus} onConnect={connectSync} onDisconnect={disconnectSync} onGenerate={generateNewKey}/>}
        {tab==="Orders"    && <OrdersTab orders={orders} setOrders={setOrd} filaments={filaments} setFilaments={setFil} models={models} extras={extras} settings={settings} activeOrder={activeOrder} setActiveOrder={setActiveOrder} orderView={orderView} setOrderView={setOrderView} accent={accent} setSett={setSett}/>}
      </div>
    </div>
  );
}

// ─── NavBar ────────────────────────────────────────────────────────────────────
function NavBar({ tab, setTab, accent, friendMode, toggleFriend, syncDot, onSyncTab }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [narrow, setNarrow] = useState(window.innerWidth < 640);
  const menuRef = useRef();

  useEffect(() => {
    const handler = () => setNarrow(window.innerWidth < 640);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = e => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div style={{background:"#141420",borderBottom:"1px solid #2a2a3a",padding:"0 20px",position:"sticky",top:0,zIndex:10}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",maxWidth:1100,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 0"}}>
          <span style={{fontSize:20}}>🖨️</span>
          <span style={{fontWeight:700,fontSize:16,color:accent}}>PrintCost</span>
          <span onClick={onSyncTab} title="Sync status" style={{cursor:"pointer",fontSize:14}}>{syncDot}</span>
        </div>
        {narrow ? (
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={toggleFriend} style={{padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:600,fontSize:11,background:friendMode?accent:"#2a2a3a",color:friendMode?"#fff":"#888"}}>{friendMode?"👥":"👤"}</button>
            <div style={{position:"relative"}} ref={menuRef}>
              <button onClick={()=>setMenuOpen(o=>!o)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #2a2a3a",background:"#1a1a28",color:"#ccc",cursor:"pointer",fontSize:18,lineHeight:1}}>☰</button>
              {menuOpen && (
                <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",background:"#1a1a28",border:"1px solid #2a2a3a",borderRadius:10,overflow:"hidden",minWidth:160,boxShadow:"0 8px 24px #0008",zIndex:20}}>
                  {TABS.map(t=>(
                    <button key={t} onClick={()=>{setTab(t);setMenuOpen(false);}} style={{display:"block",width:"100%",textAlign:"left",padding:"10px 16px",border:"none",background:tab===t?accent:"transparent",color:tab===t?"#fff":"#ccc",fontWeight:600,fontSize:13,cursor:"pointer"}}>{t}</button>
                  ))}
                  <div style={{borderTop:"1px solid #2a2a3a",padding:"10px 16px"}}>
                    <button onClick={()=>{toggleFriend();setMenuOpen(false);}} style={{background:"none",border:"none",color:"#aaa",fontWeight:600,fontSize:13,cursor:"pointer",padding:0}}>{friendMode?"👥 Friend Mode ON":"👤 Normal Mode"}</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <>
            <div style={{display:"flex",gap:2}}>
              {TABS.map(t=>(
                <button key={t} onClick={()=>setTab(t)} style={{padding:"7px 14px",borderRadius:8,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,background:tab===t?accent:"transparent",color:tab===t?"#fff":"#999",transition:"all .15s"}}>{t}</button>
              ))}
            </div>
            <button onClick={toggleFriend} style={{padding:"5px 14px",borderRadius:20,border:"none",cursor:"pointer",fontWeight:600,fontSize:12,background:friendMode?accent:"#2a2a3a",color:friendMode?"#fff":"#888"}}>{friendMode?"👥 Friend Mode":"👤 Normal"}</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Settings ──────────────────────────────────────────────────────────────────
function SettingsTab({ settings, setSettings, filaments, setFilaments, models, setModels, extras, setExtras, orders, setOrders, accent, syncKey, syncStatus, onConnect, onDisconnect, onGenerate }) {
  const upd = (k,v) => setSettings(s=>({...s,[k]:v}));
  const fileRef = useRef();
  const [keyInput, setKeyInput] = useState("");
  const [newType, setNewType] = useState("");
  const advanced = settings.invoiceMode === "advanced";
  const allData = { filaments, models, extras, orders, settings };
  const handleImport = d => {
    if (d.filaments) setFilaments(d.filaments);
    if (d.models) setModels(d.models);
    if (d.extras) setExtras(d.extras);
    if (d.orders) setOrders(d.orders);
    if (d.settings) setSettings({...DEFAULT_SETTINGS,...d.settings});
    alert("Imported!");
  };
  return (
    <div style={{maxWidth:600}}>
      <SectionHeader accent={accent}>Settings</SectionHeader>
      <GroupLabel>App</GroupLabel>
      <Card style={{marginBottom:16}}>
        <Row2>
          <Field label="Brand / Name"><input value={settings.brandName} onChange={e=>upd("brandName",e.target.value)} placeholder="Wence 3D Prints" style={inp}/></Field>
          <Field label="Accent Color">
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <input value={settings.accentColor||"#7c3aed"} onChange={e=>upd("accentColor",e.target.value)} style={{...inp,fontFamily:"monospace"}}/>
              <div style={{width:34,height:34,borderRadius:7,background:settings.accentColor||"#7c3aed",border:"1px solid #2a2a3a",flexShrink:0}}/>
              <input type="color" value={settings.accentColor||"#7c3aed"} onChange={e=>upd("accentColor",e.target.value)} style={{width:34,height:34,borderRadius:7,border:"none",cursor:"pointer",padding:0,flexShrink:0}}/>
            </div>
          </Field>
        </Row2>
        <Row3 style={{marginTop:10}}>
          <Field label="Cost/Print Minute (CZK)"><input value={settings.cppm??""} type="number" step="0.01" onChange={e=>upd("cppm",e.target.value)} style={inp}/></Field>
          <Field label="Electricity/Minute (CZK)"><input value={settings.electricityPerMinute??""} type="number" step="0.001" onChange={e=>upd("electricityPerMinute",e.target.value)} style={inp}/></Field>
          <Field label="Low Stock Warning (g)"><input value={settings.lowStockGrams??""} type="number" step="10" onChange={e=>upd("lowStockGrams",parseFloat(e.target.value)||0)} style={inp}/></Field>
        </Row3>
      </Card>
      <GroupLabel>Plastic Types</GroupLabel>
      <Card style={{marginBottom:16}}>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
          {(settings.plasticTypes||TYPES).map(t=>(
            <div key={t} style={{display:"flex",alignItems:"center",gap:4,background:"#2a2a3a",borderRadius:6,padding:"3px 8px"}}>
              <span style={{fontSize:12,color:"#ccc"}}>{t}</span>
              <button onClick={()=>upd("plasticTypes",(settings.plasticTypes||TYPES).filter(x=>x!==t))} style={{...ghostBtn,padding:"1px 3px",fontSize:11}}>✕</button>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <input value={newType} onChange={e=>setNewType(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&newType.trim()){upd("plasticTypes",[...(settings.plasticTypes||TYPES),newType.trim()]);setNewType("");}}} placeholder="Add type (e.g. PETG-CF)" style={{...inp,flex:1}}/>
          <Btn accent={accent} onClick={()=>{if(newType.trim()){upd("plasticTypes",[...(settings.plasticTypes||TYPES),newType.trim()]);setNewType("");}}}>Add</Btn>
        </div>
      </Card>
      <GroupLabel>Invoice</GroupLabel>
      <Card style={{marginBottom:16}}>
        <div style={{display:"flex",gap:16,marginBottom:14,flexWrap:"wrap"}}>
          <Toggle label="Czech invoice language" checked={settings.czechInvoice} onChange={v=>upd("czechInvoice",v)} accent={accent}/>
          <Toggle label="Advanced invoice (freelancer)" checked={advanced} onChange={v=>upd("invoiceMode",v?"advanced":"simple")} accent={accent}/>
        </div>
        <Row2 style={{marginBottom:14}}>
          <Field label="Next invoice number"><input value={settings.invoiceCounter??1} type="number" min={1} onChange={e=>upd("invoiceCounter",parseInt(e.target.value)||1)} style={inp}/></Field>
        </Row2>
        {advanced && <>
          <GroupLabel style={{marginTop:4}}>Supplier (your details)</GroupLabel>
          <Row2 style={{marginBottom:8}}>
            <Field label="Full Name / Company"><input value={settings.supplierName} onChange={e=>upd("supplierName",e.target.value)} placeholder="Jan Novák" style={inp}/></Field>
            <Field label="Street Address"><input value={settings.supplierAddress} onChange={e=>upd("supplierAddress",e.target.value)} placeholder="Václavské náměstí 1" style={inp}/></Field>
          </Row2>
          <Row3 style={{marginBottom:8}}>
            <Field label="ZIP"><input value={settings.supplierZip} onChange={e=>upd("supplierZip",e.target.value)} placeholder="110 00" style={inp}/></Field>
            <Field label="City"><input value={settings.supplierCity} onChange={e=>upd("supplierCity",e.target.value)} placeholder="Praha" style={inp}/></Field>
            <Field label="Country"><input value={settings.supplierCountry} onChange={e=>upd("supplierCountry",e.target.value)} placeholder="Česká republika" style={inp}/></Field>
          </Row3>
          <Row3 style={{marginBottom:8}}>
            <Field label="IČO"><input value={settings.supplierICO} onChange={e=>upd("supplierICO",e.target.value)} placeholder="12345678" style={inp}/></Field>
            <Field label="E-mail"><input value={settings.supplierEmail} onChange={e=>upd("supplierEmail",e.target.value)} placeholder="jan@example.cz" style={inp}/></Field>
            <Field label="Phone"><input value={settings.supplierPhone} onChange={e=>upd("supplierPhone",e.target.value)} placeholder="+420 777 000 000" style={inp}/></Field>
          </Row3>
          <GroupLabel style={{marginTop:8}}>Banking</GroupLabel>
          <Row3 style={{marginBottom:8}}>
            <Field label="Account No."><input value={settings.bankAccount} onChange={e=>upd("bankAccount",e.target.value)} placeholder="123456789/0800" style={inp}/></Field>
            <Field label="IBAN"><input value={settings.bankIBAN} onChange={e=>upd("bankIBAN",e.target.value)} placeholder="CZ65 0800 0000 1920 0014 5399" style={inp}/></Field>
            <Field label="BIC/SWIFT"><input value={settings.bankBIC} onChange={e=>upd("bankBIC",e.target.value)} placeholder="GIBACZPX" style={inp}/></Field>
          </Row3>
          <GroupLabel style={{marginTop:8}}>Invoice defaults</GroupLabel>
          <Row2>
            <Field label="Payment due (days)"><input value={settings.paymentDueDays??14} type="number" min={1} onChange={e=>upd("paymentDueDays",parseInt(e.target.value)||14)} style={inp}/></Field>
          </Row2>
        </>}
      </Card>
      <GroupLabel>Cloud Sync (Firestore)</GroupLabel>
      <Card style={{marginBottom:16}}>
        {syncKey ? (
          <>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
              <span style={{fontSize:18}}>{syncStatus==="syncing"?"🔄":syncStatus==="ok"?"🟢":"🔴"}</span>
              <span style={{fontSize:13,color:"#aaa"}}>{syncStatus==="syncing"?"Syncing…":syncStatus==="ok"?"Synced":"Sync error — check connection"}</span>
            </div>
            <div style={{marginBottom:10}}>
              <label style={{fontSize:12,color:"#aaa",display:"block",marginBottom:5}}>Your sync key</label>
              <div style={{display:"flex",gap:8}}>
                <input readOnly value={syncKey} style={{...inp,fontFamily:"monospace",fontSize:11,color:"#c084fc"}}/>
                <Btn accent={accent} small onClick={()=>{const ta=document.createElement("textarea");ta.value=syncKey;ta.style.position="fixed";ta.style.opacity="0";document.body.appendChild(ta);ta.focus();ta.select();document.execCommand("copy");document.body.removeChild(ta);}}>📋 Copy</Btn>
              </div>
              <p style={{fontSize:11,color:"#555",margin:"6px 0 0"}}>Paste this key on another device to sync your data. Keep it private.</p>
            </div>
            <Btn accent={accent} onClick={onDisconnect} style={{background:"#3a1a1a",color:"#f87171"}}>Disconnect</Btn>
          </>
        ) : (
          <>
            <p style={{fontSize:12,color:"#aaa",marginTop:0,marginBottom:12}}>Generate a key to start syncing, or paste an existing key from another device.</p>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <input value={keyInput} onChange={e=>setKeyInput(e.target.value)} placeholder="Paste existing sync key…" style={{...inp,fontFamily:"monospace",fontSize:12}}/>
              <Btn accent={accent} primary onClick={()=>onConnect(keyInput)} style={{whiteSpace:"nowrap"}}>Connect</Btn>
            </div>
            <Btn accent={accent} onClick={onGenerate}>✨ Generate new key</Btn>
          </>
        )}
      </Card>
      <GroupLabel>Data</GroupLabel>
      <Card>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <Btn accent={accent} onClick={()=>exportData(allData,"printcost-backup.json")}>⬇ Export All</Btn>
          <Btn accent={accent} onClick={()=>fileRef.current.click()}>⬆ Import All</Btn>
        </div>
        <input ref={fileRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{if(e.target.files[0])importData(e.target.files[0],handleImport);e.target.value="";}}/>
        <p style={{fontSize:11,color:"#555",marginTop:8,marginBottom:0}}>Import replaces all data. Export first to back up.</p>
      </Card>
    </div>
  );
}

// ─── Filaments ─────────────────────────────────────────────────────────────────
const emptyFil = () => ({brand:"",type:"PLA",color:"",pricePerKg:"",stockGrams:""});
function FilamentsTab({ filaments, setFilaments, settings, accent }) {
  const [form, setForm] = useState(emptyFil());
  const [editId, setEditId] = useState(null);
  const impRef = useRef();
  const upd = (k,v) => setForm(f=>({...f,[k]:v}));
  const submit = () => {
    if (!form.brand.trim()||!form.color.trim()||!form.pricePerKg) return;
    const entry={...form,pricePerKg:parseFloat(form.pricePerKg),stockGrams:parseFloat(form.stockGrams)||0,id:editId||uid()};
    setFilaments(fs=>editId?fs.map(x=>x.id===editId?entry:x):[...fs,entry]);
    setForm(emptyFil());setEditId(null);
  };
  const startEdit=f=>{setForm({...f,pricePerKg:String(f.pricePerKg),stockGrams:String(f.stockGrams)});setEditId(f.id);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <SectionHeader accent={accent}>Filament Library</SectionHeader>
        <div style={{display:"flex",gap:8}}>
          <Btn accent={accent} small onClick={()=>exportData(filaments,"filaments.json")}>⬇</Btn>
          <Btn accent={accent} small onClick={()=>impRef.current.click()}>⬆</Btn>
          <input ref={impRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{if(e.target.files[0])importData(e.target.files[0],d=>{if(Array.isArray(d))setFilaments(d);});e.target.value="";}}/>
        </div>
      </div>
      <Card style={{marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:"#aaa",marginBottom:12}}>{editId?"Edit":"Add"} Filament</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:10}}>
          <input value={form.brand} onChange={e=>upd("brand",e.target.value)} placeholder="Brand" style={inp}/>
          <select value={form.type} onChange={e=>upd("type",e.target.value)} style={inp}>{(settings.plasticTypes||TYPES).map(t=><option key={t}>{t}</option>)}</select>
          <input value={form.color} onChange={e=>upd("color",e.target.value)} placeholder="Color" style={inp}/>
          <input value={form.pricePerKg} onChange={e=>upd("pricePerKg",e.target.value)} placeholder="Price/kg" type="number" style={inp}/>
          <input value={form.stockGrams} onChange={e=>upd("stockGrams",e.target.value)} placeholder="Stock (g)" type="number" style={inp}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn accent={accent} primary onClick={submit}>{editId?"Update":"Add"}</Btn>
          {editId&&<Btn accent={accent} onClick={()=>{setForm(emptyFil());setEditId(null);}}>Cancel</Btn>}
        </div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
        {filaments.map(f=>{
          const low=f.stockGrams<=(settings.lowStockGrams||100);
          return (
            <Card key={f.id} style={{borderColor:low?accent+"55":undefined}}>
              <div style={{display:"flex",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontWeight:700}}>{f.brand} <span style={{color:accent}}>{f.type}</span></div>
                  <div style={{color:"#aaa",fontSize:12,marginTop:2}}>{f.color}</div>
                  <div style={{marginTop:8,fontSize:12,display:"flex",gap:12}}>
                    <span style={{color:"#86efac"}}>{f.pricePerKg} CZK/kg</span>
                    <span style={{color:low?"#f87171":"#aaa"}}>{low&&"⚠️ "}{f.stockGrams}g</span>
                  </div>
                </div>
                <div style={{display:"flex",gap:6,alignSelf:"flex-start"}}>
                  <Btn accent={accent} small onClick={()=>startEdit(f)}>✏️</Btn>
                  <Btn accent={accent} small onClick={()=>setFilaments(fs=>fs.filter(x=>x.id!==f.id))}>🗑️</Btn>
                </div>
              </div>
            </Card>
          );
        })}
        {!filaments.length&&<div style={{color:"#555",fontSize:13}}>No filaments yet.</div>}
      </div>
    </div>
  );
}

// ─── Models ────────────────────────────────────────────────────────────────────
const emptyModel = () => ({name:"",description:"",weightSlots:[{id:uid(),label:"Main",grams:""}]});
function ModelsTab({ models, setModels, accent }) {
  const [form, setForm] = useState(emptyModel());
  const [editId, setEditId] = useState(null);
  const impRef = useRef();
  const updSlot=(id,k,v)=>setForm(f=>({...f,weightSlots:f.weightSlots.map(s=>s.id===id?{...s,[k]:v}:s)}));
  const addSlot=()=>setForm(f=>({...f,weightSlots:[...f.weightSlots,{id:uid(),label:"",grams:""}]}));
  const delSlot=id=>setForm(f=>({...f,weightSlots:f.weightSlots.filter(s=>s.id!==id)}));
  const submit=()=>{
    if(!form.name.trim())return;
    const entry={...form,weightSlots:form.weightSlots.map(s=>({...s,grams:parseFloat(s.grams)||0})),id:editId||uid()};
    setModels(ms=>editId?ms.map(x=>x.id===editId?entry:x):[...ms,entry]);
    setForm(emptyModel());setEditId(null);
  };
  const startEdit=m=>{setForm({...m,weightSlots:m.weightSlots.map(s=>({...s,grams:String(s.grams)}))});setEditId(m.id);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <SectionHeader accent={accent}>Model Library</SectionHeader>
        <div style={{display:"flex",gap:8}}>
          <Btn accent={accent} small onClick={()=>exportData(models,"models.json")}>⬇</Btn>
          <Btn accent={accent} small onClick={()=>impRef.current.click()}>⬆</Btn>
          <input ref={impRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{if(e.target.files[0])importData(e.target.files[0],d=>{if(Array.isArray(d))setModels(d);});e.target.value="";}}/>
        </div>
      </div>
      <Card style={{marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:"#aaa",marginBottom:12}}>{editId?"Edit":"Add"} Model</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8,marginBottom:12}}>
          <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Model name" style={inp}/>
          <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Description" style={inp}/>
        </div>
        {form.weightSlots.map(s=>(
          <div key={s.id} style={{display:"flex",gap:8,marginBottom:8}}>
            <input value={s.label} onChange={e=>updSlot(s.id,"label",e.target.value)} placeholder="Slot name" style={{...inp,flex:1}}/>
            <input value={s.grams} onChange={e=>updSlot(s.id,"grams",e.target.value)} placeholder="Grams" type="number" style={{...inp,width:90}}/>
            {form.weightSlots.length>1&&<button onClick={()=>delSlot(s.id)} style={ghostBtn}>✕</button>}
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <Btn accent={accent} onClick={addSlot}>+ Slot</Btn>
          <Btn accent={accent} primary onClick={submit}>{editId?"Update":"Save"}</Btn>
          {editId&&<Btn accent={accent} onClick={()=>{setForm(emptyModel());setEditId(null);}}>Cancel</Btn>}
        </div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
        {models.map(m=>(
          <Card key={m.id}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontWeight:700}}>{m.name}</div>
                {m.description&&<div style={{color:"#aaa",fontSize:12,marginTop:2}}>{m.description}</div>}
                <div style={{marginTop:8}}>
                  {m.weightSlots.map(s=><div key={s.id} style={{fontSize:12,color:accent}}>{s.label}: {s.grams}g</div>)}
                  <div style={{fontSize:12,color:"#86efac",marginTop:4}}>Total: {m.weightSlots.reduce((a,s)=>a+(parseFloat(s.grams)||0),0)}g</div>
                </div>
              </div>
              <div style={{display:"flex",gap:6,alignSelf:"flex-start"}}>
                <Btn accent={accent} small onClick={()=>startEdit(m)}>✏️</Btn>
                <Btn accent={accent} small onClick={()=>setModels(ms=>ms.filter(x=>x.id!==m.id))}>🗑️</Btn>
              </div>
            </div>
          </Card>
        ))}
        {!models.length&&<div style={{color:"#555",fontSize:13}}>No models yet.</div>}
      </div>
    </div>
  );
}

// ─── Extras ────────────────────────────────────────────────────────────────────
const emptyExtra = () => ({name:"",description:"",unitPrice:"",unit:"item"});
function ExtrasTab({ extras, setExtras, accent }) {
  const [form, setForm] = useState(emptyExtra());
  const [editId, setEditId] = useState(null);
  const impRef = useRef();
  const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
  const submit=()=>{
    if(!form.name.trim()||!form.unitPrice)return;
    const entry={...form,unitPrice:parseFloat(form.unitPrice)||0,id:editId||uid()};
    setExtras(es=>editId?es.map(x=>x.id===editId?entry:x):[...es,entry]);
    setForm(emptyExtra());setEditId(null);
  };
  const startEdit=e=>{setForm({...e,unitPrice:String(e.unitPrice)});setEditId(e.id);};
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <SectionHeader accent={accent}>Extras &amp; Services</SectionHeader>
        <div style={{display:"flex",gap:8}}>
          <Btn accent={accent} small onClick={()=>exportData(extras,"extras.json")}>⬇</Btn>
          <Btn accent={accent} small onClick={()=>impRef.current.click()}>⬆</Btn>
          <input ref={impRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{if(e.target.files[0])importData(e.target.files[0],d=>{if(Array.isArray(d))setExtras(d);});e.target.value="";}}/>
        </div>
      </div>
      <Card style={{marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:600,color:"#aaa",marginBottom:12}}>{editId?"Edit":"Add"} Extra</div>
        <div style={{display:"grid",gridTemplateColumns:"2fr 2fr 1fr 1fr",gap:8,marginBottom:10}}>
          <input value={form.name} onChange={e=>upd("name",e.target.value)} placeholder="Name" style={inp}/>
          <input value={form.description} onChange={e=>upd("description",e.target.value)} placeholder="Description" style={inp}/>
          <input value={form.unitPrice} onChange={e=>upd("unitPrice",e.target.value)} placeholder="Price (CZK)" type="number" style={inp}/>
          <input value={form.unit} onChange={e=>upd("unit",e.target.value)} placeholder="Unit" style={inp}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn accent={accent} primary onClick={submit}>{editId?"Update":"Add"}</Btn>
          {editId&&<Btn accent={accent} onClick={()=>{setForm(emptyExtra());setEditId(null);}}>Cancel</Btn>}
        </div>
      </Card>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
        {extras.map(ex=>(
          <Card key={ex.id}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <div>
                <div style={{fontWeight:700}}>{ex.name}</div>
                {ex.description&&<div style={{color:"#aaa",fontSize:12,marginTop:2}}>{ex.description}</div>}
                <div style={{fontSize:12,color:"#86efac",marginTop:6}}>{ex.unitPrice} CZK / {ex.unit||"item"}</div>
              </div>
              <div style={{display:"flex",gap:6,alignSelf:"flex-start"}}>
                <Btn accent={accent} small onClick={()=>startEdit(ex)}>✏️</Btn>
                <Btn accent={accent} small onClick={()=>setExtras(es=>es.filter(x=>x.id!==ex.id))}>🗑️</Btn>
              </div>
            </div>
          </Card>
        ))}
        {!extras.length&&<div style={{color:"#555",fontSize:13}}>No extras yet.</div>}
      </div>
    </div>
  );
}

// ─── Orders ────────────────────────────────────────────────────────────────────
function OrdersTab({ orders, setOrders, filaments, setFilaments, models, extras, settings, activeOrder, setActiveOrder, orderView, setOrderView, accent, setSett }) {
  const impRef = useRef();
  const newOrder=()=>{
    setActiveOrder({id:uid(),name:"",description:"",printMinutes:"",electricityMinutes:"",items:[],extraLines:[],images:[],clientName:"",clientAddress:"",clientCity:"",clientZip:"",clientCountry:"",clientEmail:""});
    setOrderView("edit");
  };
  const openEdit=o=>{setActiveOrder(JSON.parse(JSON.stringify(o)));setOrderView("edit");};
  const delOrder=id=>setOrders(os=>os.filter(o=>o.id!==id));
  const saveOrder=o=>{
    const isNew=!orders.find(x=>x.id===o.id);
    if(isNew){
      const deltas={};
      (o.items||[]).forEach(item=>(item.filamentUses||[]).forEach(fu=>{if(fu.filamentId)deltas[fu.filamentId]=(deltas[fu.filamentId]||0)+(parseFloat(fu.grams)||0);}));
      setFilaments(fs=>fs.map(f=>deltas[f.id]?{...f,stockGrams:Math.max(0,f.stockGrams-deltas[f.id])}:f));
      setSett(s=>({...s,invoiceCounter:(parseInt(s.invoiceCounter)||1)+1}));
    }
    setOrders(os=>isNew?[...os,o]:os.map(x=>x.id===o.id?o:x));
    setOrderView("list");
  };
  if(orderView==="edit"&&activeOrder){
    return <OrderEditor order={activeOrder} setOrder={setActiveOrder} filaments={filaments} models={models} extras={extras} settings={settings} onSave={saveOrder} onCancel={()=>setOrderView("list")} accent={accent}/>;
  }
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <SectionHeader accent={accent}>Orders</SectionHeader>
        <div style={{display:"flex",gap:8}}>
          <Btn accent={accent} small onClick={()=>exportData(orders,"orders.json")}>⬇</Btn>
          <Btn accent={accent} small onClick={()=>impRef.current.click()}>⬆</Btn>
          <input ref={impRef} type="file" accept=".json" style={{display:"none"}} onChange={e=>{if(e.target.files[0])importData(e.target.files[0],d=>{if(Array.isArray(d))setOrders(d);});e.target.value="";}}/>
          <Btn accent={accent} primary onClick={newOrder}>+ New</Btn>
        </div>
      </div>
      {!orders.length&&<div style={{color:"#555",fontSize:13}}>No orders yet.</div>}
      <div style={{display:"grid",gap:10}}>
        {orders.map(o=>{
          const total=calcOrderTotal(o,filaments,extras,settings);
          return (
            <Card key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700}}>{o.name||"Untitled Order"}</div>
                {o.clientName&&<div style={{color:"#aaa",fontSize:12,marginTop:1}}>{o.clientName}{o.clientEmail?` · ${o.clientEmail}`:""}</div>}
                {o.description&&<div style={{color:"#666",fontSize:12,marginTop:1}}>{o.description}</div>}
                <div style={{fontSize:12,color:"#aaa",marginTop:4}}>{(o.items||[]).length} model(s)</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontWeight:700,color:"#86efac",fontSize:16,minWidth:100,textAlign:"right"}}>{fmtCZK(total,settings.czechInvoice)}</span>
                <Btn accent={accent} small onClick={()=>openEdit(o)}>✏️</Btn>
                <Btn accent={accent} small onClick={()=>exportInvoice(o,filaments,extras,settings,String(settings.invoiceCounter||1).padStart(6,"0"))}>📄</Btn>
                <Btn accent={accent} small onClick={()=>delOrder(o.id)}>🗑️</Btn>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Order Editor ──────────────────────────────────────────────────────────────
function OrderEditor({ order, setOrder, filaments, models, extras, settings, onSave, onCancel, accent }) {
  const upd=(k,v)=>setOrder(o=>({...o,[k]:v}));
  const advanced=settings.invoiceMode==="advanced";
  const addItem=model=>{
    const slots=model?model.weightSlots:[{id:uid(),label:"Main",grams:0}];
    const item={id:uid(),modelId:model?.id||null,modelName:model?.name||"Custom",qty:1,filamentMarkup:"",
      filamentUses:slots.map(s=>({id:uid(),slotLabel:s.label,grams:s.grams,filamentId:""}))};
    setOrder(o=>({...o,items:[...(o.items||[]),item]}));
  };
  const delItem=id=>setOrder(o=>({...o,items:o.items.filter(i=>i.id!==id)}));
  const updItem=(id,k,v)=>setOrder(o=>({...o,items:o.items.map(i=>i.id===id?{...i,[k]:v}:i)}));
  const updFU=(iid,fid,k,v)=>setOrder(o=>({...o,items:o.items.map(i=>i.id!==iid?i:{...i,filamentUses:i.filamentUses.map(fu=>fu.id===fid?{...fu,[k]:v}:fu)})}));
  const addFU=iid=>setOrder(o=>({...o,items:o.items.map(i=>i.id!==iid?i:{...i,filamentUses:[...i.filamentUses,{id:uid(),slotLabel:"Extra",grams:0,filamentId:""}]})}));
  const delFU=(iid,fid)=>setOrder(o=>({...o,items:o.items.map(i=>i.id!==iid?i:{...i,filamentUses:i.filamentUses.filter(fu=>fu.id!==fid)})}));
  const addExtraLine=ex=>setOrder(o=>({...o,extraLines:[...(o.extraLines||[]),{id:uid(),extraId:ex.id,qty:1}]}));
  const updEL=(id,k,v)=>setOrder(o=>({...o,extraLines:(o.extraLines||[]).map(el=>el.id===id?{...el,[k]:v}:el)}));
  const delEL=id=>setOrder(o=>({...o,extraLines:(o.extraLines||[]).filter(el=>el.id!==id)}));
  const handleImage=e=>{
    Array.from(e.target.files).forEach(file=>{
      const r=new FileReader();
      r.onload=ev=>setOrder(o=>({...o,images:[...(o.images||[]),{id:uid(),name:file.name,data:ev.target.result}]}));
      r.readAsDataURL(file);
    });
  };
  const filTotal=(order.items||[]).reduce((sum,item)=>{
    const mult=1+(parseFloat(item.filamentMarkup)||0)/100;
    return sum+(item.filamentUses||[]).reduce((s,fu)=>{const f=filaments.find(x=>x.id===fu.filamentId);return s+(f?(parseFloat(fu.grams)||0)/1000*f.pricePerKg*mult:0);},0);
  },0);
  const ptCost=!settings.friendMode?(parseFloat(order.printMinutes)||0)*(parseFloat(settings.cppm)||0):0;
  const elCost=!settings.friendMode?(parseFloat(order.electricityMinutes)||0)*(parseFloat(settings.electricityPerMinute)||0):0;
  const extraTotal=(order.extraLines||[]).reduce((s,el)=>{
    if(el.extraId){const ex=extras.find(x=>x.id===el.extraId);return s+(ex?(parseFloat(el.qty)||1)*(parseFloat(ex.unitPrice)||0):0);}
    return s+(parseFloat(el.qty)||1)*(parseFloat(el.unitPrice)||0);
  },0);
  const total=filTotal+ptCost+elCost+extraTotal;
  return (
    <div>
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:20}}>
        <button onClick={onCancel} style={{...ghostBtn,fontSize:20}}>←</button>
        <h2 style={{color:accent,margin:0}}>Order Editor</h2>
      </div>
      <Card style={{marginBottom:14}}>
        <Row2>
          <input value={order.name} onChange={e=>upd("name",e.target.value)} placeholder="Order name" style={inp}/>
          <input value={order.description} onChange={e=>upd("description",e.target.value)} placeholder="Description" style={inp}/>
        </Row2>
      </Card>
      {advanced&&(
        <Card style={{marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:"#aaa",marginBottom:10}}>Client</div>
          <Row2 style={{marginBottom:8}}>
            <input value={order.clientName||""} onChange={e=>upd("clientName",e.target.value)} placeholder="Client name" style={inp}/>
            <input value={order.clientEmail||""} onChange={e=>upd("clientEmail",e.target.value)} placeholder="Client e-mail" style={inp}/>
          </Row2>
          <Row2 style={{marginBottom:8}}>
            <input value={order.clientAddress||""} onChange={e=>upd("clientAddress",e.target.value)} placeholder="Street address" style={inp}/>
            <input value={order.clientCity||""} onChange={e=>upd("clientCity",e.target.value)} placeholder="City" style={inp}/>
          </Row2>
          <Row2>
            <input value={order.clientZip||""} onChange={e=>upd("clientZip",e.target.value)} placeholder="ZIP" style={inp}/>
            <input value={order.clientCountry||""} onChange={e=>upd("clientCountry",e.target.value)} placeholder="Country" style={inp}/>
          </Row2>
        </Card>
      )}
      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <span style={{fontSize:13,fontWeight:600,color:"#aaa"}}>Models</span>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <select defaultValue="" onChange={e=>{if(e.target.value){addItem(models.find(m=>m.id===e.target.value)||null);e.target.value="";} }} style={{...inp,width:"auto",fontSize:12,padding:"5px 10px"}}>
              <option value="" disabled>Add from library…</option>
              {models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <Btn accent={accent} small onClick={()=>addItem(null)}>+ Custom</Btn>
          </div>
        </div>
        {!(order.items||[]).length&&<div style={{color:"#555",fontSize:12}}>No models yet.</div>}
        {(order.items||[]).map(item=>(
          <div key={item.id} style={{background:"#0f0f18",borderRadius:10,padding:12,marginBottom:10,border:"1px solid #2a2a3a"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <span style={{fontWeight:700,color:accent,fontSize:13}}>{item.modelName}</span>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{color:"#aaa",fontSize:12}}>qty</span>
                  <input value={item.qty} type="number" min={1} onChange={e=>updItem(item.id,"qty",parseInt(e.target.value)||1)} style={{...inp,width:56,padding:"4px 8px",fontSize:12}}/>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{color:"#aaa",fontSize:12}}>markup</span>
                  <div style={{position:"relative",display:"flex",alignItems:"center"}}>
                    <input value={item.filamentMarkup===undefined||item.filamentMarkup===""?"":item.filamentMarkup} type="number" min={-100} step={5}
                      onChange={e=>updItem(item.id,"filamentMarkup",e.target.value===""?"":parseFloat(e.target.value))}
                      placeholder="0" style={{...inp,width:68,padding:"4px 20px 4px 8px",fontSize:12}}/>
                    <span style={{position:"absolute",right:7,fontSize:12,color:"#888",pointerEvents:"none"}}>%</span>
                  </div>
                </div>
              </div>
              <Btn accent={accent} small onClick={()=>delItem(item.id)}>🗑️</Btn>
            </div>
            {(item.filamentUses||[]).map(fu=>{
              const fil=filaments.find(f=>f.id===fu.filamentId);
              const mult=1+(parseFloat(item.filamentMarkup)||0)/100;
              const base=fil?(parseFloat(fu.grams)||0)/1000*fil.pricePerKg:0;
              const cost=fil?(base*mult).toFixed(2):"—";
              return (
                <div key={fu.id} style={{display:"grid",gridTemplateColumns:"110px 1fr 90px 72px 24px",gap:6,marginBottom:6,alignItems:"center"}}>
                  <input value={fu.slotLabel} onChange={e=>updFU(item.id,fu.id,"slotLabel",e.target.value)} placeholder="Slot" style={{...inp,fontSize:12,padding:"5px 8px"}}/>
                  <select value={fu.filamentId} onChange={e=>updFU(item.id,fu.id,"filamentId",e.target.value)} style={{...inp,fontSize:12,padding:"5px 8px"}}>
                    <option value="">— Select —</option>
                    {filaments.map(f=><option key={f.id} value={f.id}>{f.brand} {f.type} – {f.color}</option>)}
                  </select>
                  <input value={fu.grams===0?"":fu.grams} type="number" onChange={e=>updFU(item.id,fu.id,"grams",e.target.value===""?"":parseFloat(e.target.value)||0)} placeholder="g" style={{...inp,fontSize:12,padding:"5px 8px"}}/>
                  <span style={{color:"#86efac",fontSize:12,textAlign:"right"}}>{cost} CZK</span>
                  <button onClick={()=>delFU(item.id,fu.id)} style={{...ghostBtn,fontSize:13}}>✕</button>
                </div>
              );
            })}
            <Btn accent={accent} small onClick={()=>addFU(item.id)}>+ Filament slot</Btn>
          </div>
        ))}
      </Card>
      {!settings.friendMode&&(
        <Card style={{marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:600,color:"#aaa",marginBottom:10}}>Time &amp; Electricity</div>
          <Row2>
            <div>
              <label style={{fontSize:11,color:"#aaa",display:"block",marginBottom:4}}>Print time (hours)</label>
              <input value={order.printMinutes===""||order.printMinutes===undefined?"":Math.round((parseFloat(order.printMinutes)||0)/60*100)/100} type="number" step="0.1" onChange={e=>upd("printMinutes",e.target.value===""?"":Math.round(parseFloat(e.target.value)*60)||0)} placeholder="e.g. 2.5" style={inp}/>
              <div style={{fontSize:11,color:"#aaa",marginTop:2}}>{order.printMinutes||0} min</div>
              <div style={{fontSize:11,color:"#86efac",marginTop:2}}>{ptCost.toFixed(2)} CZK</div>
            </div>
            <div>
              <label style={{fontSize:11,color:"#aaa",display:"block",marginBottom:4}}>Electricity (min)</label>
              <input value={order.electricityMinutes===""||order.electricityMinutes===undefined?"":order.electricityMinutes} type="number" onChange={e=>upd("electricityMinutes",e.target.value===""?"":parseFloat(e.target.value)||0)} placeholder="e.g. 120" style={inp}/>
              <div style={{fontSize:11,color:"#86efac",marginTop:4}}>{elCost.toFixed(2)} CZK</div>
            </div>
          </Row2>
        </Card>
      )}
      <Card style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
          <span style={{fontSize:13,fontWeight:600,color:"#aaa"}}>Extras &amp; Services</span>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <select defaultValue="" onChange={e=>{if(e.target.value){const ex=extras.find(x=>x.id===e.target.value);if(ex)addExtraLine(ex);e.target.value="";}}} style={{...inp,width:"auto",fontSize:12,padding:"5px 10px"}} disabled={!extras.length}>
              <option value="" disabled>{extras.length?"Add from library…":"No extras defined"}</option>
              {extras.map(ex=><option key={ex.id} value={ex.id}>{ex.name}</option>)}
            </select>
            <Btn accent={accent} small onClick={()=>setOrder(o=>({...o,extraLines:[...(o.extraLines||[]),{id:uid(),extraId:null,customName:"",qty:1,unitPrice:""}]}))}>+ Custom</Btn>
          </div>
        </div>
        {!(order.extraLines||[]).length&&<div style={{color:"#555",fontSize:12}}>No extras added.</div>}
        {(order.extraLines||[]).map(el=>{
          if(el.extraId){
            const ex=extras.find(x=>x.id===el.extraId);if(!ex)return null;
            const cost=((parseFloat(el.qty)||1)*(parseFloat(ex.unitPrice)||0)).toFixed(2);
            return (
              <div key={el.id} style={{display:"grid",gridTemplateColumns:"1fr 100px 80px 24px",gap:8,marginBottom:8,alignItems:"center"}}>
                <span style={{fontSize:13}}>{ex.name} <span style={{color:"#555",fontSize:11}}>({ex.unitPrice} CZK/{ex.unit||"item"})</span></span>
                <input value={el.qty} type="number" min={1} onChange={e=>updEL(el.id,"qty",parseInt(e.target.value)||1)} style={{...inp,padding:"5px 8px",fontSize:12}}/>
                <span style={{color:"#86efac",fontSize:12,textAlign:"right"}}>{cost} CZK</span>
                <button onClick={()=>delEL(el.id)} style={{...ghostBtn,fontSize:13}}>✕</button>
              </div>
            );
          } else {
            const cost=((parseFloat(el.qty)||1)*(parseFloat(el.unitPrice)||0)).toFixed(2);
            return (
              <div key={el.id} style={{display:"grid",gridTemplateColumns:"1fr 120px 90px 80px 24px",gap:8,marginBottom:8,alignItems:"center"}}>
                <input value={el.customName||""} onChange={e=>updEL(el.id,"customName",e.target.value)} placeholder="Service name" style={{...inp,padding:"5px 8px",fontSize:12}}/>
                <input value={el.unitPrice||""} type="number" onChange={e=>updEL(el.id,"unitPrice",e.target.value)} placeholder="Unit price" style={{...inp,padding:"5px 8px",fontSize:12}}/>
                <input value={el.qty} type="number" min={1} onChange={e=>updEL(el.id,"qty",parseInt(e.target.value)||1)} style={{...inp,padding:"5px 8px",fontSize:12}}/>
                <span style={{color:"#86efac",fontSize:12,textAlign:"right"}}>{cost} CZK</span>
                <button onClick={()=>delEL(el.id)} style={{...ghostBtn,fontSize:13}}>✕</button>
              </div>
            );
          }
        })}
      </Card>
      <Card style={{marginBottom:14}}>
        <div style={{fontSize:13,fontWeight:600,color:"#aaa",marginBottom:10}}>Images <span style={{fontWeight:400,color:"#555"}}>(optional)</span></div>
        <label style={{...inp,display:"inline-block",cursor:"pointer",width:"auto",padding:"7px 14px"}}>
          📎 Add images
          <input type="file" accept="image/*" multiple onChange={handleImage} style={{display:"none"}}/>
        </label>
        {(order.images||[]).length>0&&(
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:10}}>
            {(order.images||[]).map(img=>(
              <div key={img.id} style={{position:"relative"}}>
                <img src={img.data} alt={img.name} style={{width:80,height:80,objectFit:"cover",borderRadius:8,border:"1px solid #2a2a3a"}}/>
                <button onClick={()=>setOrder(o=>({...o,images:o.images.filter(i=>i.id!==img.id)}))} style={{position:"absolute",top:2,right:2,background:"#141420",border:"none",borderRadius:"50%",cursor:"pointer",color:"#aaa",width:18,height:18,fontSize:11,lineHeight:"18px",textAlign:"center"}}>✕</button>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card style={{marginBottom:16,background:"#12121e"}}>
        {[
          {label:"Filament",val:filTotal},
          ...(!settings.friendMode?[{label:`Print time (${order.printMinutes||0} min)`,val:ptCost},{label:`Electricity (${order.electricityMinutes||0} min)`,val:elCost}]:[]),
          ...(extraTotal>0?[{label:"Extras & services",val:extraTotal}]:[])
        ].map(({label,val})=>(
          <div key={label} style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#aaa",marginBottom:5}}>
            <span>{label}</span><span style={{color:"#e8e8f0"}}>{fmtCZK(val,settings.czechInvoice)}</span>
          </div>
        ))}
        <div style={{display:"flex",justifyContent:"space-between",fontWeight:700,fontSize:17,borderTop:"1px solid #2a2a3a",paddingTop:10,marginTop:6}}>
          <span>Total</span><span style={{color:"#86efac"}}>{fmtCZK(total,settings.czechInvoice)}</span>
        </div>
      </Card>
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <Btn accent={accent} primary onClick={()=>onSave(order)}>💾 Save Order</Btn>
        <Btn accent={accent} onClick={()=>exportInvoice(order,filaments,extras,settings,String(settings.invoiceCounter||1).padStart(6,"0"))}>📄 Export Invoice</Btn>
        <Btn accent={accent} onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

// ─── Shared UI ─────────────────────────────────────────────────────────────────
const inp = {background:"#0f0f18",border:"1px solid #2a2a3a",borderRadius:8,color:"#e8e8f0",padding:"8px 12px",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
const ghostBtn = {background:"none",border:"none",color:"#666",cursor:"pointer",padding:"4px 6px",borderRadius:6};
const Card=({children,style})=><div style={{background:"#141420",border:"1px solid #2a2a3a",borderRadius:12,padding:16,...style}}>{children}</div>;
const Btn=({children,onClick,primary,small,accent="#7c3aed",style})=>(
  <button onClick={onClick} style={{padding:small?"5px 10px":"8px 18px",borderRadius:8,border:"none",cursor:"pointer",fontSize:small?12:13,fontWeight:600,whiteSpace:"nowrap",background:primary?accent:"#2a2a3a",color:primary?"#fff":"#ccc",...style}}>{children}</button>
);
const SectionHeader=({children,accent})=><h2 style={{color:accent,margin:"0 0 16px"}}>{children}</h2>;
const GroupLabel=({children,style})=><div style={{fontSize:11,fontWeight:700,color:"#555",textTransform:"uppercase",letterSpacing:".06em",margin:"0 0 8px",...style}}>{children}</div>;
const Field=({label,children})=><div><label style={{display:"block",marginBottom:5,fontSize:12,color:"#aaa"}}>{label}</label>{children}</div>;
const Row2=({children,style})=><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,...style}}>{children}</div>;
const Row3=({children,style})=><div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,...style}}>{children}</div>;
const Toggle=({label,checked,onChange,accent})=>(
  <div style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}} onClick={()=>onChange(!checked)}>
    <div style={{width:36,height:20,borderRadius:10,background:checked?accent:"#2a2a3a",position:"relative",transition:"background .2s",flexShrink:0}}>
      <div style={{position:"absolute",top:3,left:checked?18:3,width:14,height:14,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
    </div>
    <span style={{fontSize:13,color:"#ccc"}}>{label}</span>
  </div>
);

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));