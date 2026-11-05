// Filament-Tracker – Quellcode (JSX).
// Nach jeder Änderung zu app.js übersetzen (Babel, Preset "react"), index.html lädt nur app.js.
const {useState,useEffect,useRef,useCallback}=React;

// ── Responsive scaling ──
// Das gesamte UI ist pixelgenau für ~400px Breite entworfen. Statt hunderte
// Werte umzuschreiben, skalieren wir das komplette Design proportional zur
// tatsächlichen Bildschirmbreite, damit es auf jedem Handy exakt passt.
const DESIGN_WIDTH=400;
function useViewport(){
  const [vp,setVp]=useState(()=>({
    width:typeof window!=="undefined"?window.innerWidth:DESIGN_WIDTH,
    height:typeof window!=="undefined"?window.innerHeight:800,
  }));
  useEffect(()=>{
    let raf=null;
    function calc(){
      if(raf)cancelAnimationFrame(raf);
      raf=requestAnimationFrame(()=>setVp({width:window.innerWidth,height:window.innerHeight}));
    }
    window.addEventListener("resize",calc);
    window.addEventListener("orientationchange",calc);
    return ()=>{
      if(raf)cancelAnimationFrame(raf);
      window.removeEventListener("resize",calc);
      window.removeEventListener("orientationchange",calc);
    };
  },[]);
  // Skalierung: schrumpft auf schmalen Screens, wächst moderat auf breiten.
  const zoom=Math.max(0.6,Math.min(1.3,vp.width/DESIGN_WIDTH));
  return {...vp,zoom,isMobile:vp.width<=600};
}

const VERSION="v7.22";
const STORAGE_KEY="filament_v3";
const API_KEY_KEY="filament_apikey";
const PRINTERS_KEY="filament_printers";
const SCALE_HOST_KEY="filament_scale_host";
const DEFAULT_SCALE_HOST="spulenwaage.local";
const DEFAULT_PRINTERS=["Bambu H2C","VCore 4.1","HevOrt"];
const MATERIALS=["PLA","PETG","ABS","ASA","ABS-GF","XPETG","TPU","PA","PC","PVA","HIPS","CF","Sonstiges"];
const DIAMETERS=[1.75,2.85];

const EINHEITEN_KEY="filament_printer_units";
// Design v7 "Spulenwand": dunkle, neutrale Flächen – Farbe kommt von den Spulen
const MINT="#86efac",BG="#0d0d10",SURFACE="#17171b",SURFACE2="#1f1f25";
const BORDER="#2a2a31",TEXT="#f4f4f5",TEXT_DIM="#a1a1aa",TEXT_MUTED="#71717a",ROT="#fb7185";
// Name stammt aus dem alten Design (Monospace) – steht jetzt für die Grundschrift
const mono={fontFamily:"'Inter',system-ui,-apple-system,sans-serif"};

// ── Storage ──
function loadFilaments(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||[];}catch{return[];}}
function saveFilaments(d){localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}
function loadApiKey(){return localStorage.getItem(API_KEY_KEY)||"";}
function saveApiKey(k){localStorage.setItem(API_KEY_KEY,k);}
function loadPrinters(){try{return JSON.parse(localStorage.getItem(PRINTERS_KEY))||DEFAULT_PRINTERS;}catch{return DEFAULT_PRINTERS;}}
function savePrinters(p){localStorage.setItem(PRINTERS_KEY,JSON.stringify(p));}
function loadScaleHost(){return localStorage.getItem(SCALE_HOST_KEY)||DEFAULT_SCALE_HOST;}
function saveScaleHost(h){localStorage.setItem(SCALE_HOST_KEY,h||DEFAULT_SCALE_HOST);}
// Einheiten je Drucker (AMS, INDX, externe Spule …): {"Bambu H2C":[{name:"A",slots:4},…]}
function loadEinheiten(){try{return JSON.parse(localStorage.getItem(EINHEITEN_KEY))||{};}catch{return{};}}
function saveEinheiten(e){localStorage.setItem(EINHEITEN_KEY,JSON.stringify(e));}
// Fotos je Drucker, verkleinert als data:-Adresse: {"Bambu H2C":"data:image/jpeg;base64,…"}
const FOTOS_KEY="filament_printer_photos";
function loadFotos(){try{return JSON.parse(localStorage.getItem(FOTOS_KEY))||{};}catch{return{};}}
function saveFotos(f){try{localStorage.setItem(FOTOS_KEY,JSON.stringify(f));}catch{}}
// Foto quadratisch zuschneiden und auf 160×160 px verkleinern (nur wenige KB)
function fotoVerkleinern(datei){
  return new Promise((ok,fehler)=>{
    const url=URL.createObjectURL(datei), img=new Image();
    img.onload=()=>{
      const s=Math.min(img.width,img.height), c=document.createElement("canvas");
      c.width=c.height=160;
      c.getContext("2d").drawImage(img,(img.width-s)/2,(img.height-s)/2,s,s,0,0,160,160);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg",0.8));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);fehler(new Error("Das Bild ließ sich nicht öffnen."));};
    img.src=url;
  });
}

// ── Server-Speicher (PocketBase im Heimnetz) ──
// Läuft die App auf dem PocketBase-Server (Ordner pb_public), speichert sie dort,
// damit alle Geräte denselben Stand haben. Auf GitHub o.ä. bleibt alles wie bisher
// nur im Browser. localStorage dient im Server-Betrieb als Zwischenspeicher.
async function pbVerfuegbar(){
  try{const r=await fetch("/api/health",{cache:"no-store"});return r.ok;}catch{return false;}
}
async function pbAlle(tabelle){
  let page=1,items=[];
  for(;;){
    const r=await fetch(`/api/collections/${tabelle}/records?perPage=500&page=${page}`,{cache:"no-store"});
    if(!r.ok)throw new Error(`Laden ${tabelle}: HTTP ${r.status}`);
    const j=await r.json();
    items=items.concat(j.items||[]);
    if(!j.totalPages||page>=j.totalPages)break;
    page++;
  }
  return items;
}
async function pbSchreiben(methode,tabelle,id,daten){
  const r=await fetch(`/api/collections/${tabelle}/records`+(id?`/${id}`:""),{
    method:methode,
    headers:daten?{"Content-Type":"application/json"}:{},
    body:daten?JSON.stringify(daten):undefined,
  });
  if(!r.ok)throw new Error(`${methode} ${tabelle}: HTTP ${r.status}`);
  return r.status===204?null:r.json();
}
// Filamente vom Server: sortiert nach Anlagedatum, damit die Reihenfolge auf allen Geräten gleich ist
async function pbFilamenteLaden(){
  const recs=await pbAlle("filamente");
  const stand=new Map(), fils=[];
  for(const r of recs){
    if(!r.daten)continue;
    const f={...r.daten,id:r.app_id};
    stand.set(r.app_id,{rid:r.id,json:JSON.stringify(f)});
    fils.push(f);
  }
  fils.sort((a,b)=>(a.addedAt||0)-(b.addedAt||0)||String(a.id).localeCompare(String(b.id)));
  return {stand,fils};
}
// Messungen der Waage auf die Spulen anwenden: die neueste Messung je Spule gewinnt.
// Gibt die (ggf.) geänderten Filamente zurück; Spulen ohne Messung bleiben unverändert.
function messungenAnwenden(fils,messungen){
  const neueste=new Map();
  for(const m of messungen){
    const alt=neueste.get(m.spool_id);
    if(!alt||String(m.created)>String(alt.created))neueste.set(m.spool_id,m);
  }
  return fils.map(f=>{
    let neu=f;
    for(const liste of ["stock","inUse"]){
      const arr=f[liste]||[];
      if(!arr.some(s=>neueste.has(s.id)))continue;
      neu={...neu,[liste]:arr.map(s=>{
        const m=neueste.get(s.id);
        if(!m)return s;
        const zeit=Date.parse(String(m.created||"").replace(" ","T"))||Date.now();
        return {...s,weight:Math.max(0,Math.round(m.gramm||0)),gewogenAm:zeit};
      })};
    }
    return neu;
  });
}
// Wird von der App gesetzt, damit geänderte Materialien/Lagerorte zum Server gehen
let einstellungenGeaendert=()=>{};

// Text in die Zwischenablage – mit Ausweichweg, weil navigator.clipboard ohne HTTPS fehlt
function kopieren(text){
  if(navigator.clipboard&&window.isSecureContext)return navigator.clipboard.writeText(text);
  return new Promise((ok,fehler)=>{
    const el=document.createElement("textarea");
    el.value=text;el.style.position="fixed";el.style.opacity="0";
    document.body.appendChild(el);el.select();
    const erfolg=document.execCommand("copy");
    document.body.removeChild(el);
    erfolg?ok():fehler(new Error("Kopieren nicht möglich"));
  });
}

function genId(){return Math.random().toString(36).slice(2,9)+Date.now().toString(36);}

// ── Backup ──
function exportBackup(filaments,printers,einheiten){
  const data={version:"7.0",exported:new Date().toISOString(),filaments,printers,einheiten};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`filament-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
function importBackup(file,onSuccess,onError){
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.filaments)throw new Error("Ungültiges Format");
      onSuccess(data);
    }catch(err){onError(err.message);}
  };
  reader.readAsText(file);
}

function calcPct(w,full){if(!full)return 0;return Math.min(100,Math.max(0,Math.round(w/full*100)));}
// Startgewicht einer Spule: eigenes (z.B. 250-g-Spule) oder das des Filaments (vom Etikett)
function startG(fil,spule){return (spule&&spule.startWeight)||fil.fullWeight||1000;}
// "gewogen: heute 14:32" – Zeitpunkt der letzten Waagen-Messung einer Spule
function gewogenText(ts){
  if(!ts)return "";
  const d=new Date(ts), jetzt=new Date();
  const uhr=d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"});
  const tage=Math.round((new Date(jetzt.toDateString())-new Date(d.toDateString()))/86400000);
  if(tage===0)return `heute ${uhr}`;
  if(tage===1)return `gestern ${uhr}`;
  return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"});
}

function gramColor(w,full){
  if(!full||w<=100)return"#ff2020";
  const t=Math.min(1,(w-100)/(full-100));
  const r=t<0.5?255:Math.round(255*(1-(t-0.5)*2));
  const g=t<0.5?Math.round(t*2*200):200;
  return`rgb(${r},${g},0)`;
}

// ── AI Scan ──
async function scanLabel(b64,mediaType,mode,apiKey){
  const multiColorTerms="Dual Color,Dual Colour,Bicolor,Two-Color,2-Color,Silk Dual,Tri Color,Tri Colour,Three-Color,3-Color,Tricolor,Rainbow,Multicolor,Multi-Color,Gradient,Galaxy,Marble,Silk Rainbow,Chameleon";
  const sys=mode==="add"
    ?`Filament label reader. Return ONLY valid JSON no markdown: {"brand":"","material":"","colorName":"","colorHex":"","diameter":null,"fullWeight":null,"notes":""}. Only fill values that are printed on or clearly visible on the label – never guess or use defaults. fullWeight = net filament weight in grams as printed (e.g. 1kg → 1000); diameter in mm as printed; use null if not printed. colorHex may be estimated from the visible filament/label color. IMPORTANT: If the label contains any multi-color indicator (${multiColorTerms}), set colorHex to an array of 2-3 hex colors (e.g. ["#ff0000","#0000ff"]) extracted or estimated from the label visuals. For single-color filaments, colorHex remains a single string.`
    :`Filament label reader. Return ONLY valid JSON: {"brand":"","material":"","colorName":"","colorHex":""}. If multi-color filament (${multiColorTerms}), set colorHex to array of 2-3 hex strings.`;
  const res=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":apiKey,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:"claude-haiku-4-5",max_tokens:500,system:sys,
      messages:[{role:"user",content:[
        {type:"image",source:{type:"base64",media_type:mediaType,data:b64}},
        {type:"text",text:"Extract filament info."}
      ]}]
    })
  });
  const data=await res.json();
  if(data.error)throw new Error(data.error.message);
  const text=data.content?.map(b=>b.text||"").join("")||"{}";
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

function matchScore(fil,scan){
  let s=0;
  if(scan.brand&&fil.brand?.toLowerCase().includes(scan.brand.toLowerCase()))s+=3;
  if(scan.material&&fil.material?.toLowerCase()===scan.material.toLowerCase())s+=3;
  if(scan.colorName&&fil.colorName?.toLowerCase().includes(scan.colorName.toLowerCase()))s+=2;
  if(scan.colorHex&&fil.colorHex){
    try{
      const p=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
      const h1=Array.isArray(scan.colorHex)?scan.colorHex[0]:scan.colorHex;
      const h2=Array.isArray(fil.colorHex)?fil.colorHex[0]:fil.colorHex;
      const [r1,g1,b1]=p(h1),[r2,g2,b2]=p(h2);
      if(Math.sqrt((r1-r2)**2+(g1-g2)**2+(b1-b2)**2)<60)s+=1;
    }catch{}
  }
  return s;
}

// ── RFID / NFC (OpenSpool) ──
// Tag-Inhalt im OpenSpool-Format (NDEF-Record, MIME application/json) für NTAG215/216.
// Zusatzfelder (spool_id, color_name, ...) werden von OpenSpool-Lesern ignoriert,
// damit die eigene Waage die Spule der App zuordnen kann.
const MATERIAL_TEMPS={
  "PLA":[190,230],"PETG":[220,260],"XPETG":[230,260],"ABS":[230,270],"ABS-GF":[240,280],
  "ASA":[240,270],"TPU":[210,240],"PA":[250,290],"PC":[260,300],"PVA":[190,220],"HIPS":[220,250],"CF":[220,260],
};
const NTAG_CAPACITY={"NTAG213":137,"NTAG215":496,"NTAG216":868}; // nutzbare NDEF-Bytes (ca.)
const hasWebNFC=typeof window!=="undefined"&&"NDEFReader" in window;

function buildOpenSpool(fil,spool){
  const colors=(Array.isArray(fil.colorHex)?fil.colorHex:[fil.colorHex||"#aaaaaa"]).map(c=>String(c).replace("#","").toUpperCase());
  const temps=MATERIAL_TEMPS[(fil.material||"").toUpperCase()];
  const p={protocol:"openspool",version:"1.0",type:fil.material||"",color_hex:colors[0],brand:fil.brand||"Generic"};
  if(temps){p.min_temp=String(temps[0]);p.max_temp=String(temps[1]);}
  if(colors.length>1)p.additional_color_hexes=colors.slice(1);
  if(fil.colorName)p.color_name=fil.colorName;
  p.diameter=String(fil.diameter||1.75);
  p.weight=String(spool?startG(fil,spool):(fil.fullWeight||1000));
  if(spool)p.spool_id=spool.id;
  return p;
}
function payloadBytes(p){return new TextEncoder().encode(JSON.stringify(p)).length;}

// Android/Chrome: direkt aufs Tag schreiben (Handy an den Tag halten).
async function writeTagWebNFC(payload){
  const ndef=new NDEFReader();
  await ndef.write({records:[{recordType:"mime",mediaType:"application/json",data:new TextEncoder().encode(JSON.stringify(payload))}]});
}
// iPhone: Daten an die Waage (ESPHome) übergeben, deren PN532 schreibt.
// Seitenwechsel statt fetch(): HTTPS→HTTP-Navigation ist erlaubt, die Daten stehen im #-Teil
// und werden von rfid_writer.js auf der Waage (gleicher Ursprung) ans Textfeld geschickt.
const HA_TEXT_MAX=255; // max_length einer ESPHome-Text-Entität
// Optionale Felder werden in dieser Reihenfolge weggelassen, bis der Inhalt passt.
const OPTIONAL_FIELDS=["diameter","weight","color_name","additional_color_hexes","min_temp","max_temp"];
function fitPayload(p,max){
  const out={...p};
  for(const k of OPTIONAL_FIELDS){
    if(payloadBytes(out)<=max)break;
    delete out[k];
  }
  return out;
}
function scaleWriteUrl(host,payload){
  return `http://${host}/#rfid=${encodeURIComponent(JSON.stringify(payload))}`;
}

// ── Gewicht von der Waage übernehmen ──
// Die App öffnet http://<waage>/#sync=<App-Adresse>. rfid_writer.js auf der Waage liest
// Spulen-ID + Netto-Gewicht und antwortet per postMessage oder per Rücksprung
// <App-Adresse>#waage=<Ergebnis>. Ergebnis: "ok:<spoolId>:<gramm>" oder "fehler:<grund>".
function scaleSyncUrl(host,appUrl){
  return `http://${host}/#sync=${encodeURIComponent(appUrl)}`;
}
function parseScaleResult(raw){
  if(typeof raw!=="string")return null;
  const ok=raw.match(/^ok:([^:]+):(-?\d+)$/);
  if(ok)return {id:ok[1],g:Math.max(0,parseInt(ok[2],10))};
  const f=raw.match(/^fehler:(\w+)$/);
  return f?{fehler:f[1]}:null;
}
function findSpool(filaments,id){
  for(const fil of filaments){
    const s=(fil.stock||[]).find(x=>x.id===id);
    if(s)return {fil,spool:s,liste:"stock",ort:s.location||"Lager"};
    const u=(fil.inUse||[]).find(x=>x.id===id);
    if(u)return {fil,spool:u,liste:"inUse",ort:`${u.printer}${u.slot?" · "+u.slot:""}`};
  }
  return null;
}
const SCALE_ERRORS={
  kein_tag:"Auf der Waage liegt keine Spule mit lesbarem Tag. Spule auflegen (ggf. kurz abheben und neu auflegen) und nochmal versuchen.",
  keine_id:"Auf dem Tag steht keine Spulen-ID. Tag neu schreiben und dabei eine Spule auswählen (nicht „Ohne Spulen-ID“).",
  kein_leergewicht:"Für diese Spule ist kein Leergewicht gespeichert. Tag einmal neu schreiben – dabei muss die Spule auf der Waage liegen.",
  unbekannt:"Die Spule vom Tag gibt es in der App nicht (mehr). Vielleicht wurde sie gelöscht oder auf einem anderen Gerät angelegt.",
};

// ── UI Primitives ──
const inputStyle={...mono,background:BG,border:`1px solid ${BORDER}`,borderRadius:10,
  color:TEXT,padding:"10px 12px",fontSize:14,width:"100%",boxSizing:"border-box",outline:"none",WebkitAppearance:"none"};
const labelCss={...mono,color:TEXT_MUTED,fontSize:11,fontWeight:600,marginBottom:5,display:"block",letterSpacing:"0.06em"};

function colorBg(hex){
  if(Array.isArray(hex)&&hex.length>1){
    const stops=hex.join(", ");
    return `linear-gradient(135deg, ${stops})`;
  }
  const c=Array.isArray(hex)?hex[0]:hex;
  return c||"#333";
}
function ColorChip({hex,size=28}){
  const bg=colorBg(hex);
  const isGrad=Array.isArray(hex)&&hex.length>1;
  return <div style={{width:size,height:size,borderRadius:"50%",background:bg,border:`1px solid rgba(255,255,255,0.12)`,flexShrink:0,position:"relative"}}>
    {isGrad&&<div style={{position:"absolute",top:1,right:2,fontSize:size>20?7:6,lineHeight:1,color:"rgba(255,255,255,0.6)"}}>◈</div>}
  </div>;
}
function RemainingBar({weight,fullWeight}){
  const pct=calcPct(weight,fullWeight);
  const color=gramColor(weight,fullWeight);
  return <div style={{width:"100%",height:4,background:"#26262c",borderRadius:3,overflow:"hidden"}}>
    <div style={{width:`${pct}%`,height:"100%",background:color,transition:"width 0.3s,background 0.3s"}}/>
  </div>;
}
function Badge({color,bg,children}){
  return <span style={{...mono,background:bg||SURFACE2,color:color||TEXT_DIM,fontSize:11,padding:"3px 8px",borderRadius:99,whiteSpace:"nowrap"}}>{children}</span>;
}
function Field({label,children}){
  return <div style={{display:"flex",flexDirection:"column"}}><span style={labelCss}>{label}</span>{children}</div>;
}
function PhotoButton({label,onChange,loading}){
  const ref=useRef();
  return <>
    <button onClick={()=>ref.current.click()} style={{
      width:"100%",padding:"14px 0",background:loading?SURFACE2:TEXT,
      border:loading?"1px solid #facc15":"none",borderRadius:14,
      color:loading?"#facc15":BG,cursor:"pointer",fontSize:15,fontWeight:700,...mono
    }}>{loading?"⏳ Scanne...":label}</button>
    <input ref={ref} type="file" accept="image/*" capture="environment" onChange={onChange} style={{display:"none"}}/>
  </>;
}
function Modal({title,children,onClose}){
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)",zIndex:100,display:"flex",alignItems:"flex-end",justifyContent:"center"}}>
    <div style={{background:SURFACE,borderTop:`1px solid ${BORDER}`,borderRadius:"26px 26px 0 0",
      width:"100%",maxWidth:520,maxHeight:"92vh",overflowY:"auto",overflowX:"hidden",color:TEXT,
      padding:"10px 18px calc(24px + env(safe-area-inset-bottom))",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{width:38,height:5,borderRadius:5,background:"#3f3f46",alignSelf:"center",marginBottom:2}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{color:TEXT,fontWeight:700,fontSize:19,letterSpacing:"-0.01em",...mono}}>{title}</span>
        <button onClick={onClose} aria-label="Schließen" style={{background:SURFACE2,border:"none",color:TEXT_DIM,width:32,height:32,borderRadius:16,fontSize:15,cursor:"pointer",lineHeight:1}}>✕</button>
      </div>
      {children}
    </div>
  </div>;
}

// ── Printer Combo ──
function PrinterSelect({value,onChange,printers}){
  const [custom,setCustom]=useState(false);
  const [customVal,setCustomVal]=useState("");
  function handleSelect(v){
    if(v==="__new__"){setCustom(true);setCustomVal("");}
    else{setCustom(false);onChange(v);}
  }
  function confirmCustom(){
    const v=customVal.trim();
    if(v){onChange(v);setCustom(false);}
  }
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    <select style={inputStyle} value={custom?"__new__":value} onChange={e=>handleSelect(e.target.value)}>
      <option value="">— kein Drucker —</option>
      {printers.map(p=><option key={p}>{p}</option>)}
      <option value="__new__">✏️ Neuer Drucker...</option>
    </select>
    {custom&&<div style={{display:"flex",gap:6}}>
      <input style={{...inputStyle,flex:1}} value={customVal} onChange={e=>setCustomVal(e.target.value)}
        placeholder="Druckername..." autoFocus onKeyDown={e=>e.key==="Enter"&&confirmCustom()}/>
      <button onClick={confirmCustom} style={{background:TEXT,color:BG,border:"none",borderRadius:6,padding:"0 12px",cursor:"pointer",fontWeight:700,...mono}}>OK</button>
    </div>}
  </div>;
}

// ── Material Combo ──
function loadCustomMats(){try{return JSON.parse(localStorage.getItem("custom_materials")||"[]");}catch{return[];}}
function saveCustomMat(m){if(!m||MATERIALS.includes(m))return;const cur=loadCustomMats();if(!cur.includes(m)){localStorage.setItem("custom_materials",JSON.stringify([...cur,m]));einstellungenGeaendert();}}

function MaterialCombo({value,onChange}){
  const [custom,setCustom]=useState(!MATERIALS.includes(value)&&!!value);
  const [userPicked,setUserPicked]=useState(false);
  const customMats=loadCustomMats();
  const allMats=[...MATERIALS,...customMats.filter(m=>!MATERIALS.includes(m))];
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    <select style={inputStyle} value={custom?"__custom__":value}
      onChange={e=>{if(e.target.value==="__custom__"){setCustom(true);setUserPicked(true);onChange("");}else{setCustom(false);onChange(e.target.value);}}}>
      <option value="">— wählen —</option>
      {allMats.map(m=><option key={m}>{m}</option>)}
      <option value="__custom__">✏️ Eigene Eingabe...</option>
    </select>
    {custom&&<input style={{...inputStyle,borderColor:MINT}} value={value}
      onChange={e=>onChange(e.target.value)}
      onBlur={e=>saveCustomMat(e.target.value)}
      placeholder="z.B. PLA-CF, PAHT..." autoFocus={userPicked}/>}
  </div>;
}


// ── Location Storage + Combo ──
function loadCustomLocs(){try{return JSON.parse(localStorage.getItem("custom_locations")||"[]");}catch{return[];}}
function saveCustomLoc(l){if(!l)return;const cur=loadCustomLocs();if(!cur.includes(l)){localStorage.setItem("custom_locations",JSON.stringify([...cur,l]));einstellungenGeaendert();}}

function LocationCombo({value,onChange}){
  const locs=loadCustomLocs();
  const [custom,setCustom]=useState(locs.length>0&&!locs.includes(value)&&!!value);
  const [userPicked,setUserPicked]=useState(false);
  return <div style={{display:"flex",flexDirection:"column",gap:4}}>
    {locs.length>0
      ?<select style={inputStyle} value={custom?"__custom__":value||""}
          onChange={e=>{if(e.target.value==="__custom__"){setCustom(true);setUserPicked(true);onChange("");}else{setCustom(false);onChange(e.target.value);}}}>
          <option value="">— Lagerort wählen —</option>
          {locs.map(l=><option key={l}>{l}</option>)}
          <option value="__custom__">✏️ Neuer Lagerort...</option>
        </select>
      :<input style={inputStyle} value={value} onChange={e=>onChange(e.target.value)}
          onBlur={e=>saveCustomLoc(e.target.value)} placeholder="Lagerort (z.B. Regal-A)"/>
    }
    {custom&&<input style={{...inputStyle,borderColor:MINT}} value={value}
      onChange={e=>onChange(e.target.value)}
      onBlur={e=>{saveCustomLoc(e.target.value);}}
      placeholder="z.B. Regal-A, Box-2..." autoFocus={userPicked}/>}
  </div>;
}

// ── QR Scanner Screen ──
function QRScannerScreen({filaments,onOpen}){
  const [result,setResult]=useState(null);
  const [error,setError]=useState("");
  const [status,setStatus]=useState("Wird gestartet...");
  const scannerRef=useRef(null);
  const divId="qr-reader-filament";
  // Live-Kamera gibt es im Browser nur über https. Über http://<Server>:8080 wird stattdessen
  // ein Foto aufgenommen und der QR-Code darin erkannt.
  const live=!!(window.isSecureContext&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia);
  const [pruefe,setPruefe]=useState(false);

  useEffect(()=>{
    startScanner();
    return ()=>stopScanner();
  },[]);

  function startScanner(){
    setError("");setResult(null);setStatus("Kamera wird geöffnet...");
    if(!live)return;
    if(scannerRef.current){
      scannerRef.current.stop().catch(()=>{}).finally(()=>{
        scannerRef.current.clear();
        scannerRef.current=null;
        const el=document.getElementById(divId);
        if(el)el.innerHTML="";
        setTimeout(initScanner,80);
      });
    }else{
      setTimeout(initScanner,80);
    }
  }

  // QR-Bibliothek (370 KB) erst laden, wenn der Scanner gebraucht wird – macht den App-Start schneller
  function bibliothek(weiter){
    if(window.Html5Qrcode){weiter();return;}
    const sk=document.createElement("script");
    sk.src="./vendor/html5-qrcode.min.js";
    sk.onload=weiter;
    sk.onerror=()=>{setPruefe(false);setError("QR-Scanner konnte nicht geladen werden.");};
    document.head.appendChild(sk);
  }
  // Foto → QR-Code. Gelaserte Codes auf Alu (Spiegelungen, schmaler heller Rand ans schwarze Metall)
  // erkennt die Standard-Erkennung oft nicht. Deshalb jsQR, mehrere Bildgrößen und viele
  // Hell/Dunkel-Schwellen (reines Schwarz/Weiß), bis der Code gefunden ist.
  function jsqrLaden(){
    if(window.jsQR)return Promise.resolve();
    return new Promise((ok,f)=>{const sk=document.createElement("script");sk.src="./vendor/jsqr.min.js";sk.onload=ok;sk.onerror=f;document.head.appendChild(sk);});
  }
  async function qrAusFoto(file){
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((ok,f)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=f;i.src=url;});
      for(const max of [1000,800,600,1200]){
        const f=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        const w=Math.round(img.naturalWidth*f), h=Math.round(img.naturalHeight*f);
        const c=document.createElement("canvas");c.width=w;c.height=h;
        const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(img,0,0,w,h);
        const bild=ctx.getImageData(0,0,w,h), roh=new Uint8ClampedArray(bild.data), d=bild.data;
        let j=jsQR(roh,w,h,{inversionAttempts:"attemptBoth"});
        if(j&&j.data)return j.data;
        const grau=new Uint8ClampedArray(w*h);
        for(let i=0;i<grau.length;i++)grau[i]=roh[i*4]*0.299+roh[i*4+1]*0.587+roh[i*4+2]*0.114;
        for(let t=60;t<=210;t+=6){
          for(let i=0;i<grau.length;i++){const v=grau[i]>t?255:0;d[i*4]=d[i*4+1]=d[i*4+2]=v;}
          j=jsQR(d,w,h,{inversionAttempts:"dontInvert"});
          if(j&&j.data)return j.data;
        }
        await new Promise(r=>setTimeout(r,0));   // Anzeige zwischendurch aktualisieren
      }
      return null;
    }finally{URL.revokeObjectURL(url);}
  }
  async function fotoGewaehlt(e){
    const file=e.target.files[0];e.target.value="";
    if(!file)return;
    setError("");setPruefe(true);
    await new Promise(r=>setTimeout(r,50));
    try{
      await jsqrLaden();
      const text=await qrAusFoto(file);
      if(text)setResult(text.trim());
      else setError("Kein QR-Code erkannt – leicht schräg fotografieren, damit nichts spiegelt. Oder unten den Lagerplatz auswählen.");
    }catch{setError("QR-Erkennung konnte nicht geladen werden.");}
    finally{setPruefe(false);}
  }

  function initScanner(){
    if(!window.Html5Qrcode){bibliothek(initScanner);return;}
    try{
      const scanner=new Html5Qrcode(divId);
      scannerRef.current=scanner;
      scanner.start(
        {facingMode:"environment"},
        {fps:10,qrbox:{width:250,height:250},aspectRatio:1.0},
        (text)=>{
          stopScanner();
          setResult(text.trim());
        },
        ()=>{}
      ).then(()=>{
        setStatus("QR-Code in den Rahmen halten...");
      }).catch(e=>{
        setError("Kamerazugriff verweigert: "+e);
      });
    }catch(e){setError("Fehler: "+(e&&e.message?e.message:String(e)));}
  }

  function stopScanner(){
    if(scannerRef.current){
      scannerRef.current.stop().catch(()=>{}).finally(()=>{
        scannerRef.current.clear();
        scannerRef.current=null;
      });
    }
  }

  const matched=result?filaments.filter(f=>
    f.stock?.some(s=>(s.location||"").toLowerCase()===result.toLowerCase())
  ):[];

  const orte=[...new Set(filaments.flatMap(f=>(f.stock||[]).map(s=>s.location)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"de"));
  const zeilen=matched.flatMap(f=>f.stock.filter(s=>(s.location||"").toLowerCase()===result.toLowerCase()).map(s=>({f,s})));
  return <div style={{padding:"12px 16px",display:"flex",flexDirection:"column",gap:12}}>
    {!result&&live&&<>
      <div style={{fontSize:14,color:TEXT_DIM,textAlign:"center"}}>QR-Code am Lagerplatz in den Rahmen halten</div>
      <div id={divId} style={{borderRadius:24,overflow:"hidden",background:"#000",boxShadow:`0 0 0 1px ${BORDER}`}}/>
      {error
        ?<div style={{color:ROT,fontSize:13,textAlign:"center"}}>{error}</div>
        :<div style={{color:TEXT_MUTED,fontSize:12,textAlign:"center"}}>{status}</div>
      }
    </>}
    {!result&&!live&&<>
      <label style={{background:SURFACE,borderRadius:24,padding:"36px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:12,cursor:"pointer",textAlign:"center"}}>
        <span style={{color:TEXT}}><Icon name="qr" size={56} stroke={1.4}/></span>
        <span style={{fontSize:17,fontWeight:700}}>{pruefe?"Erkenne QR-Code…":"QR-Code fotografieren"}</span>
        <span style={{fontSize:13,color:TEXT_DIM}}>Kamera öffnet sich – QR-Code am Lagerplatz formatfüllend aufnehmen</span>
        <input type="file" accept="image/*" capture="environment" onChange={fotoGewaehlt} style={{display:"none"}}/>
      </label>
      {error&&<div style={{color:ROT,fontSize:13,textAlign:"center"}}>{error}</div>}
    </>}
    {!result&&orte.length>0&&<div style={{marginTop:6}}>
      <div style={{...etikett,marginBottom:8}}>ODER LAGERPLATZ AUSWÄHLEN</div>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {orte.map(o=><button key={o} onClick={()=>{stopScanner();setResult(o);}} style={{...bloss,background:SURFACE2,borderRadius:99,padding:"9px 14px",fontSize:13,fontWeight:600}}>{o}</button>)}
      </div>
    </div>}

    {result&&<>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:SURFACE,borderRadius:18}}>
        <span style={{color:TEXT_DIM}}><Icon name="box" size={28}/></span>
        <div style={{flex:1}}>
          <div style={{fontSize:20,fontWeight:700}}>{result}</div>
          <div style={{fontSize:12,color:TEXT_DIM}}>{zeilen.length} Spule{zeilen.length!==1?"n":""} an diesem Lagerplatz</div>
        </div>
      </div>

      {zeilen.length===0&&<div style={{color:TEXT_DIM,fontSize:13,textAlign:"center",padding:"20px 0",lineHeight:1.6}}>
        Keine Spulen für „{result}“ gefunden.<br/>
        <span style={{fontSize:12,color:TEXT_MUTED}}>Den Lagerort beim Erfassen genau so eintragen.</span>
      </div>}

      {zeilen.map(({f,s})=>{
        const p=calcPct(s.weight,startG(f,s));
        return <button key={s.id} onClick={()=>onOpen&&onOpen(f,s.id)} style={{background:SURFACE,border:"none",borderRadius:16,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,cursor:"pointer",color:TEXT,textAlign:"left",font:"inherit"}}>
          <Ring hex={f.colorHex} pct={p} size={44} dicke={5}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:15,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.colorName||"—"}</div>
            <div style={{fontSize:12,color:TEXT_DIM}}>{f.brand} · {f.material}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:15,fontWeight:700,color:p<KNAPP?ROT:TEXT}}>{s.weight} g</div>
            <div style={{fontSize:11,color:TEXT_MUTED}}>{p} %</div>
          </div>
        </button>;
      })}

      <button onClick={startScanner} style={{background:SURFACE2,color:TEXT,border:"none",borderRadius:14,padding:"13px 0",cursor:"pointer",fontSize:14,fontWeight:600,width:"100%",fontFamily:"inherit"}}>Nächsten Lagerplatz scannen</button>
    </>}
  </div>;
}
const SORT_MODES=[
  {key:"material",label:"↕ Material"},
  {key:"low",label:"↕ Fast leer"},
  {key:"location",label:"↕ Lager/Drucker"},
];

function ListView({filaments,onEdit}){
  const [sortIdx,setSortIdx]=React.useState(0);

  if(filaments.length===0)return(
    <div style={{textAlign:"center",padding:"40px 0",...mono,color:TEXT_DIM,fontSize:12}}>Keine Filamente vorhanden</div>
  );

  const sortMode=SORT_MODES[sortIdx].key;
  const allRows=[];
  filaments.forEach(fil=>{
    const mat=fil.material||"?";
    // volle Spulen je Lagerort (und Startgewicht) zusammenfassen
    const fullByLoc={};
    (fil.stock||[]).filter(s=>s.weight>=startG(fil,s)).forEach(s=>{
      const loc=s.location||"Lager", start=startG(fil,s), k=loc+"|"+start;
      if(!fullByLoc[k])fullByLoc[k]={loc,start,cnt:0};
      fullByLoc[k].cnt++;
    });
    Object.values(fullByLoc).forEach(({loc,start,cnt})=>{
      allRows.push({type:"full",mat,fil,brand:fil.brand,colorName:fil.colorName,colorHex:fil.colorHex,loc,weight:start,start,count:cnt});
    });
    (fil.stock||[]).filter(s=>s.weight<startG(fil,s)).forEach(s=>{
      allRows.push({type:"partial",mat,fil,brand:fil.brand,colorName:fil.colorName,colorHex:fil.colorHex,loc:s.location||"Lager",weight:s.weight,start:startG(fil,s),count:1});
    });
    (fil.inUse||[]).forEach(u=>{
      allRows.push({type:"inuse",mat,fil,brand:fil.brand,colorName:fil.colorName,colorHex:fil.colorHex,loc:u.printer,weight:u.weight,start:startG(fil,u),count:1});
    });
  });

  let grouped=[];
  if(sortMode==="material"){
    const groups={};
    allRows.forEach(r=>{if(!groups[r.mat])groups[r.mat]=[];groups[r.mat].push(r);});
    grouped=Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([label,rows])=>({label,rows}));
  } else if(sortMode==="low"){
    const rows=[...allRows].sort((a,b)=>(a.weight/a.start)-(b.weight/b.start));
    grouped=[{label:null,rows}];
  } else if(sortMode==="location"){
    const groups={};
    allRows.forEach(r=>{const k=r.loc;if(!groups[k])groups[k]=[];groups[k].push(r);});
    const inuseKeys=allRows.filter(r=>r.type==="inuse").map(r=>r.loc);
    const isStorage=key=>!inuseKeys.includes(key)||allRows.some(r=>r.loc===key&&r.type!=="inuse");
    const storageKeys=Object.keys(groups).filter(k=>allRows.some(r=>r.loc===k&&r.type!=="inuse")).sort((a,b)=>a.localeCompare(b));
    const printerKeys=Object.keys(groups).filter(k=>allRows.every(r=>r.loc!==k||r.type==="inuse")).sort((a,b)=>a.localeCompare(b));
    grouped=[...storageKeys,...printerKeys].map(label=>({label,rows:groups[label]}));
  }

  const rowColor={full:MINT,partial:"#facc15",inuse:"#60a5fa"};
  const rowIcon={full:"●",partial:"◑",inuse:"▶"};
  const rowBg={full:"#17171b",partial:"#17171b",inuse:"#17171b"};
  const rowBorder={full:"#2a2a31",partial:"#2a2a31",inuse:"#1f1f25"};

  return <div style={{display:"flex",flexDirection:"column",gap:12}}>
    <button onClick={()=>setSortIdx(i=>(i+1)%SORT_MODES.length)}
      style={{alignSelf:"flex-end",...mono,fontSize:10,color:MINT,background:"#17171b",border:"1px solid #2a2a31",borderRadius:5,padding:"4px 10px",cursor:"pointer"}}>
      {SORT_MODES[sortIdx].label}
    </button>
    {grouped.map(({label,rows},gi)=>(
      <div key={label||gi}>
        {label&&<div style={{...mono,color:TEXT_DIM,fontSize:10,letterSpacing:"0.12em",marginBottom:5,paddingLeft:2}}>{label}</div>}
        <div style={{display:"flex",flexDirection:"column",gap:3}}>
          {rows.map((row,i)=>(
            <div key={i} onClick={()=>onEdit&&onEdit(row.fil)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"5px 8px",background:rowBg[row.type],borderRadius:5,border:"1px solid "+rowBorder[row.type],cursor:"pointer"}}>
              <span style={{color:rowColor[row.type],fontSize:11,width:12,flexShrink:0}}>{rowIcon[row.type]}</span>
              <div style={{width:12,height:12,borderRadius:2,background:Array.isArray(row.colorHex)&&row.colorHex.length>1?`linear-gradient(135deg,${row.colorHex.join(",")})`:((Array.isArray(row.colorHex)?row.colorHex[0]:row.colorHex)||"#555"),flexShrink:0,border:"1px solid rgba(255,255,255,0.1)"}}/>
              <span style={{...mono,color:TEXT,fontSize:11,width:72,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.brand}</span>
              <span style={{...mono,color:TEXT_DIM,fontSize:11,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.colorName}</span>
              <span style={{...mono,color:TEXT_DIM,fontSize:11,width:60,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"right"}}>{row.loc}</span>
              <span style={{...mono,color:row.weight<=100?"#ff2020":rowColor[row.type],fontSize:11,fontWeight:700,width:46,textAlign:"right",flexShrink:0}}>{row.weight}g</span>
              {row.count>1&&<span style={{...mono,color:TEXT_DIM,fontSize:10,width:24,textAlign:"right",flexShrink:0}}>×{row.count}</span>}
              {row.count===1&&<span style={{width:24,flexShrink:0}}/>}
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>;
}

// ── 3D Printer Icon ──
function Icon3D({color="#60a5fa",size=13}){
  return <svg width={size} height={size} viewBox="0 0 14 14" fill="none" style={{display:"inline-block",verticalAlign:"middle",marginRight:4,flexShrink:0}}>
    <rect x="1" y="6.5" width="12" height="6" rx="1" stroke={color} strokeWidth="1.3"/>
    <path d="M3 6.5V4L7 2L11 4V6.5" stroke={color} strokeWidth="1.3"/>
    <rect x="5" y="8.5" width="4" height="2.2" rx="0.5" stroke={color} strokeWidth="1"/>
    <line x1="7" y1="4" x2="7" y2="6.5" stroke={color} strokeWidth="1" strokeDasharray="1.2,1"/>
  </svg>;
}

// ── Icons (Linien-Icons, eine Pfadangabe je Icon) ──
const ICONS={
  home:"M5 12H3l9-9 9 9h-2 M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7",
  search:"M3 10a7 7 0 1 0 14 0a7 7 0 1 0-14 0 M21 21l-6-6",
  scan:"M4 7V6a2 2 0 0 1 2-2h2 M4 17v1a2 2 0 0 0 2 2h2 M16 4h2a2 2 0 0 1 2 2v1 M16 20h2a2 2 0 0 0 2-2v-1 M5 12h14",
  scale:"M7 20h10 M6 6l6-1 6 1 M12 3v17 M9 12L6 6l-3 6a3 3 0 0 0 6 0 M21 12l-3-6-3 6a3 3 0 0 0 6 0",
  settings:"M4 6h8 M16 6h4 M14 4v4 M4 12h2 M10 12h10 M8 10v4 M4 18h11 M19 18h1 M17 16v4",
  plus:"M12 5v14 M5 12h14",
  back:"M15 6l-6 6 6 6",
  next:"M9 6l6 6-6 6",
  dots:"M5 12h.01 M12 12h.01 M19 12h.01",
  nfc:"M11 20a3 3 0 0 1-3-3V6l5 5 M13 4a3 3 0 0 1 3 3v11l-5-5 M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z",
  printer:"M17 17h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2 M17 9V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v4 M9 13h6a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z",
  box:"M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3 M12 12l8-4.5 M12 12v9 M12 12L4 7.5",
  cart:"M4 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M15 19a2 2 0 1 0 4 0a2 2 0 1 0-4 0 M17 17H6V3H4 M6 5l14 1-1 7H6",
  list:"M9 6h11 M9 12h11 M9 18h11 M5 6v.01 M5 12v.01 M5 18v.01",
  grid:"M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
  edit:"M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4 M13.5 6.5l4 4",
  trash:"M4 7h16 M10 11v6 M14 11v6 M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12 M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3",
  qr:"M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2 M20 14v2 M14 18v2h2 M18 18h2v2",
  camera:"M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2 M9 13a3 3 0 1 0 6 0a3 3 0 1 0-6 0",
};
function Icon({name,size=20,color="currentColor",stroke=1.8}){
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke}
    strokeLinecap="round" strokeLinejoin="round" style={{display:"block",flexShrink:0}}><path d={ICONS[name]}/></svg>;
}

// ── Farben & Füllstand ──
const KNAPP=15; // unter 15 % gilt eine Spule als fast leer
function hauptfarbe(hex){return (Array.isArray(hex)?hex[0]:hex)||"#71717a";}
// Sehr dunkle Filamentfarben (Schwarz) wären auf dem dunklen Hintergrund unsichtbar → etwas aufhellen
function sichtbareFarbe(c){
  const m=/^#?([0-9a-f]{6})$/i.exec(String(c||"").trim());
  if(!m)return c||"#71717a";
  const v=parseInt(m[1],16), r=v>>16&255, g=v>>8&255, b=v&255;
  if((0.2126*r+0.7152*g+0.0722*b)/255>=0.18)return "#"+m[1];
  const mix=(x,y)=>Math.round(x+(y-x)*0.45);
  return `rgb(${mix(r,161)},${mix(g,161)},${mix(b,170)})`;
}
function spulenVon(fil){return [...(fil.stock||[]),...(fil.inUse||[])];}
// Nachkaufen: alle Spulen zusammen haben weniger als 15 % einer vollen Spule (oder es gibt keine mehr)
function knapp(fil){
  const sp=spulenVon(fil);
  if(!sp.length)return true;
  return sp.reduce((a,s)=>a+(s.weight||0),0)<startG(fil)*KNAPP/100;
}
// Für die Lager-Kachel: die angebrochenste Lager-Spule
function repSpule(fil){
  const st=[...(fil.stock||[])].sort((a,b)=>a.weight/startG(fil,a)-b.weight/startG(fil,b));
  return st[0]||null;
}

// ── Drucker-Einheiten und Slots ──
// Ein Drucker besteht aus Einheiten (z.B. AMS A mit 4 Slots, externe Spule mit 1 Slot).
function einheitenVon(einheiten,drucker){
  const e=einheiten[drucker];
  if(Array.isArray(e)&&e.length)return e;
  if(/indx/i.test(drucker))return [{name:"INDX",slots:8}];
  if(/bambu|h2c|h2d|x1|p1s|p2s/i.test(drucker))return [{name:"A",slots:4},{name:"Ext",slots:1}];
  return [{name:"",slots:1}];
}
// Slot-Namen wie am Drucker: A1–A4, Ext, HT – bei langen Namen (INDX) einfach 1–8
function slotNamen(einheit){
  const n=Math.max(1,einheit.slots|0), name=(einheit.name||"").trim();
  if(n===1)return [name||"1"];
  const pre=name.length<=3?name:"";
  return Array.from({length:n},(_,i)=>`${pre}${i+1}`);
}
// Welche Spule liegt in welchem Slot? Bei Druckern mit einem Platz rückt eine Spule ohne Slot automatisch
// dorthin. Bei mehreren Slots nicht – sonst rutscht z.B. eine nicht zugeordnete Spule unbemerkt in einen
// gerade frei gewordenen Slot. Solche Spulen stehen in "extra" (Anzeige "Ohne Slot").
function belegung(filaments,drucker,einheiten){
  const proDrucker={};
  for(const fil of filaments)for(const s of fil.inUse||[])(proDrucker[s.printer]=proDrucker[s.printer]||[]).push({fil,spool:s});
  const out={};
  for(const p of drucker){
    const gruppen=einheitenVon(einheiten,p).map(e=>({name:e.name,slots:slotNamen(e).map(n=>({name:n,belegt:null}))}));
    const flach=gruppen.flatMap(g=>g.slots), ohne=[], extra=[];
    for(const x of proDrucker[p]||[]){
      const sl=flach.find(s=>s.name===x.spool.slot);
      if(sl&&!sl.belegt)sl.belegt=x;else ohne.push(x);
    }
    for(const x of ohne){const frei=flach.length===1&&!flach[0].belegt?flach[0]:null;if(frei)frei.belegt=x;else extra.push(x);}
    out[p]={gruppen,slots:flach,extra,anzahl:flach.length};
  }
  return out;
}

// ── Füllstands-Ring ──
// Füllt sich beim Erscheinen animiert auf den aktuellen Stand.
function Ring({hex,pct=0,size=64,dicke=7,leer=false,children}){
  const [p,setP]=useState(0);
  useEffect(()=>{const t=requestAnimationFrame(()=>setP(pct));return ()=>cancelAnimationFrame(t);},[pct]);
  const r=size/2-dicke/2-1, C=2*Math.PI*r, farbe=sichtbareFarbe(hauptfarbe(hex)), innen=r-dicke/2-3;
  return <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
    {!leer&&innen>2&&<div style={{position:"absolute",left:size/2-innen,top:size/2-innen,width:innen*2,height:innen*2,
      borderRadius:"50%",background:colorBg(hex),opacity:0.2}}/>}
    <svg width={size} height={size} style={{display:"block",position:"relative"}}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={leer?"#3a3a42":"#26262c"} strokeWidth={leer?1.5:dicke} strokeDasharray={leer?"3 4":undefined}/>
      {!leer&&p>0&&<circle cx={size/2} cy={size/2} r={r} fill="none" stroke={farbe} strokeWidth={dicke} strokeLinecap="round"
        strokeDasharray={`${Math.max(0.5,p/100*C)} ${C}`} transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{transition:"stroke-dasharray 0.9s cubic-bezier(.2,.8,.2,1)"}}/>}
    </svg>
    {children&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center"}}>{children}</div>}
  </div>;
}

const bloss={background:"none",border:"none",padding:0,cursor:"pointer",color:"inherit",font:"inherit"};
const etikett={...mono,fontSize:11,color:TEXT_MUTED,letterSpacing:"0.08em",fontWeight:600};

// ── Startseite: Drucker ──
function SlotZelle({slot,size,zeigeName,kompakt,onClick}){
  const b=slot.belegt;
  const pct=b?calcPct(b.spool.weight,startG(b.fil,b.spool)):0;
  const rot=b&&pct<KNAPP;
  return <button onClick={onClick} title={b?`${slot.name}: ${b.fil.brand} ${b.fil.colorName}`:`${slot.name}: leer`}
    style={{...bloss,width:"100%",display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:0}}>
    <Ring hex={b?.fil.colorHex} pct={pct} size={size} dicke={kompakt?3:size>40?5:4} leer={!b}>
      {zeigeName&&!kompakt&&slot.name.length<=3&&<span style={{fontSize:10,color:TEXT_DIM,fontWeight:600}}>{slot.name}</span>}
    </Ring>
    {!kompakt&&<span style={{fontSize:11,color:rot?ROT:b?TEXT_DIM:TEXT_MUTED,whiteSpace:"nowrap",fontWeight:rot?700:400}}>
      {b?(size>40?`${b.spool.weight} g`:b.spool.weight):"leer"}</span>}
    {/* Material: lange Namen ("High Speed PLA+") auf bis zu zwei Zeilen umbrechen statt überlappen */}
    {!kompakt&&<span style={{fontSize:10,lineHeight:1.2,color:TEXT_MUTED,width:"100%",textAlign:"center",overflowWrap:"anywhere",
      display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden",minHeight:"2.4em"}}>{b?b.fil.material:""}</span>}
  </button>;
}
function DruckerFoto({src,size}){
  if(!src)return null;
  return <img src={src} alt="" style={{width:size,height:size,borderRadius:Math.round(size/4),objectFit:"cover",flexShrink:0,display:"block"}}/>;
}
function DruckerKarte({name,foto,plan,onSlot,onOhneSlot}){
  // Eingeklappt: nur Farbpunkte. Zustand je Drucker merken (nur auf diesem Gerät).
  // Ohne gespeicherten Zustand: ab 13 Slots (3 AMS) eingeklappt, sonst offen.
  const merkKey="drucker_zu:"+name;
  const [zu,setZu]=useState(()=>{try{const v=localStorage.getItem(merkKey);return v===null?plan.anzahl>12:v==="1";}catch{return plan.anzahl>12;}});
  const umschalten=()=>setZu(z=>{const n=!z;try{localStorage.setItem(merkKey,n?"1":"0");}catch{}return n;});
  const belegtN=plan.slots.filter(s=>s.belegt).length;
  const mehrereGruppen=plan.gruppen.length>1;
  return <div style={{background:SURFACE,borderRadius:18,padding:zu?"12px":"12px 12px 8px",marginBottom:8}}>
    <button onClick={umschalten} aria-expanded={!zu} style={{...bloss,width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:zu?10:12}}>
      <span style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
        <DruckerFoto src={foto} size={32}/>
        <span style={{fontSize:14,fontWeight:600,color:TEXT}}>{name}</span>
      </span>
      <span style={{fontSize:11,color:TEXT_MUTED,display:"flex",alignItems:"center",gap:6}}>
        {belegtN} von {plan.anzahl} belegt
        <span style={{display:"inline-block",transform:zu?"rotate(0deg)":"rotate(180deg)",transition:"transform .25s",fontSize:12,color:TEXT_DIM}}>▾</span>
      </span>
    </button>
    {zu
      ?<button onClick={umschalten} aria-label={`${name} aufklappen`} style={{...bloss,width:"100%",display:"flex",flexWrap:"wrap",alignItems:"center",gap:"8px 14px"}}>
        {plan.gruppen.map((g,gi)=><span key={gi} style={{display:"flex",gap:5}}>
          {g.slots.map(sl=>{const b=sl.belegt;
            return <Ring key={sl.name} hex={b?.fil.colorHex} pct={b?calcPct(b.spool.weight,startG(b.fil,b.spool)):0} size={22} dicke={3.5} leer={!b}/>;})}
        </span>)}
        {plan.extra.length>0&&<span style={{fontSize:11,color:"#facc15"}}>+{plan.extra.length} ohne Slot</span>}
      </button>
      :<>
        {/* höchstens 4 Slots pro Reihe (z.B. INDX mit 8 Slots → 2 Reihen), damit Ringe und Materialnamen Platz haben */}
        {plan.gruppen.flatMap((g,gi)=>{
          const reihen=[];for(let i=0;i<g.slots.length;i+=4)reihen.push(g.slots.slice(i,i+4));
          return reihen.map((reihe,ri)=><div key={gi+"-"+ri} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8}}>
            {mehrereGruppen&&<span style={{width:28,fontSize:11,color:TEXT_MUTED,flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",paddingTop:16}}>{ri===0?g.name:""}</span>}
            <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:4,justifyItems:"center"}}>
              {reihe.map(sl=><SlotZelle key={sl.name} slot={sl} size={46}
                zeigeName={g.slots.length>1||mehrereGruppen} onClick={()=>onSlot(name,sl)}/>)}
            </div>
          </div>);
        })}
        {plan.extra.length>0&&<div style={{borderTop:`1px solid ${BORDER}`,paddingTop:8,marginTop:2,marginBottom:4}}>
          <div style={{fontSize:11,color:"#facc15",marginBottom:6}}>Ohne Slot – antippen und Slot wählen</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:4,justifyItems:"center"}}>
            {plan.extra.map(x=><SlotZelle key={x.spool.id} slot={{name:"?",belegt:x}} size={46} zeigeName onClick={()=>onOhneSlot(name,x)}/>)}
          </div>
        </div>}
      </>}
  </div>;
}
function DruckerKachel({name,foto,plan,onSlot}){
  const s=plan.slots[0], b=s.belegt;
  const pct=b?calcPct(b.spool.weight,startG(b.fil,b.spool)):0;
  return <button onClick={()=>onSlot(name,s)} style={{...bloss,background:SURFACE,borderRadius:16,padding:10,display:"flex",alignItems:"center",gap:10,textAlign:"left",minWidth:0}}>
    <Ring hex={b?.fil.colorHex} pct={pct} size={40} dicke={5} leer={!b}/>
    <div style={{minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:5,minWidth:0}}>
        <DruckerFoto src={foto} size={18}/>
        <div style={{fontSize:11,color:TEXT_DIM,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{name}</div>
      </div>
      <div style={{fontSize:14,fontWeight:600,color:b?(pct<KNAPP?ROT:TEXT):TEXT_MUTED}}>{b?`${b.spool.weight} g`:"leer"}</div>
      {b&&<div style={{fontSize:11,color:TEXT_MUTED,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{[b.fil.colorName,b.fil.material].filter(Boolean).join(" · ")}</div>}
      {plan.extra.length>0&&<div style={{fontSize:10,color:"#facc15"}}>+{plan.extra.length} weitere</div>}
    </div>
  </button>;
}

// ── Startseite: Lager ──
function LagerKachel({fil,spool,onClick}){
  const anzahl=(fil.stock||[]).length;
  const pct=spool?calcPct(spool.weight,startG(fil,spool)):0;
  const rot=!spool||pct<KNAPP;
  return <button onClick={onClick} style={{...bloss,display:"flex",flexDirection:"column",alignItems:"center",gap:3,minWidth:0,padding:"4px 0"}}>
    <div style={{position:"relative"}}>
      <Ring hex={fil.colorHex} pct={pct} size={68} dicke={7} leer={!spool}/>
      {anzahl>1&&<span style={{position:"absolute",top:-2,right:-6,background:TEXT,color:BG,fontSize:10,fontWeight:700,borderRadius:99,padding:"1px 6px"}}>×{anzahl}</span>}
    </div>
    <div style={{fontSize:13,fontWeight:600,color:rot?ROT:TEXT}}>{spool?`${spool.weight} g`:"leer"}</div>
    <div style={{fontSize:11,color:TEXT_DIM,maxWidth:"100%",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fil.colorName||"—"}</div>
    <div style={{fontSize:10,color:TEXT_MUTED,maxWidth:"100%",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fil.brand} {fil.material}</div>
  </button>;
}

// ── Spulen-Detail ──
function SpulenDetail({fil,spoolId,ortVon,onSpool,onBack,onEdit,onDelete,onAddSpool,onWiegen,onRfid,onPlatz}){
  const [menu,setMenu]=useState(false);
  const spulen=[
    ...(fil.stock||[]).map(s=>({s,imDrucker:false})),
    ...(fil.inUse||[]).map(s=>({s,imDrucker:true})),
  ];
  const akt=spulen.find(x=>x.s.id===spoolId)||spulen[0]||null;
  const farbe=sichtbareFarbe(hauptfarbe(fil.colorHex));
  const start=akt?startG(fil,akt.s):startG(fil);
  const pct=akt?calcPct(akt.s.weight,start):0;
  const kachel={...bloss,flex:1,background:SURFACE,borderRadius:16,padding:"12px 6px",display:"flex",flexDirection:"column",alignItems:"center",gap:6,fontSize:12,color:TEXT};
  const menuBtn={...bloss,display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 14px",fontSize:14,textAlign:"left"};

  return <div style={{minHeight:"100%",background:`radial-gradient(120% 55% at 50% 0%, ${farbe}38 0%, transparent 70%)`,padding:"calc(14px + env(safe-area-inset-top)) 16px 0"}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",position:"relative"}}>
      <button onClick={onBack} aria-label="Zurück" style={{...bloss,padding:6,color:TEXT_DIM}}><Icon name="back" size={24}/></button>
      <button onClick={()=>setMenu(m=>!m)} aria-label="Mehr" style={{...bloss,padding:6,color:TEXT_DIM}}><Icon name="dots" size={24} stroke={3}/></button>
      {menu&&<>
        <div onClick={()=>setMenu(false)} style={{position:"fixed",inset:0,zIndex:30}}/>
        <div style={{position:"absolute",right:0,top:40,zIndex:31,background:SURFACE2,border:`1px solid ${BORDER}`,borderRadius:14,minWidth:210,overflow:"hidden",boxShadow:"0 12px 32px rgba(0,0,0,0.5)"}}>
          <button onClick={()=>{setMenu(false);onEdit();}} style={menuBtn}><Icon name="edit" size={18}/>Bearbeiten</button>
          <button onClick={()=>{setMenu(false);onAddSpool();}} style={menuBtn}><Icon name="plus" size={18}/>Spule hinzufügen</button>
          <button onClick={()=>{setMenu(false);onDelete();}} style={{...menuBtn,color:ROT,borderTop:`1px solid ${BORDER}`}}><Icon name="trash" size={18}/>Filament löschen</button>
        </div>
      </>}
    </div>

    <div style={{display:"flex",justifyContent:"center",margin:"4px 0 10px"}}>
      <Ring hex={fil.colorHex} pct={pct} size={212} dicke={16} leer={!akt}>
        {akt?<>
          <div style={{fontSize:46,fontWeight:700,letterSpacing:"-0.03em",lineHeight:1,color:pct<KNAPP?ROT:TEXT}}>{akt.s.weight}<span style={{fontSize:17,color:TEXT_DIM,fontWeight:500}}> g</span></div>
          <div style={{fontSize:12,color:TEXT_DIM,marginTop:6}}>von {start} g · {pct} %</div>
        </>:<div style={{fontSize:14,color:TEXT_MUTED}}>Keine Spule</div>}
      </Ring>
    </div>

    <div style={{textAlign:"center"}}>
      <div style={{fontSize:13,color:TEXT_DIM}}>{[fil.brand,fil.material,fil.diameter&&`${fil.diameter} mm`].filter(Boolean).join(" · ")}</div>
      <div style={{fontSize:25,fontWeight:700,letterSpacing:"-0.02em",marginTop:2}}>{fil.colorName||"Ohne Farbname"}</div>
      {akt&&<div style={{fontSize:12,color:TEXT_DIM,marginTop:6,display:"flex",justifyContent:"center",alignItems:"center",gap:6,flexWrap:"wrap"}}>
        <Icon name={akt.imDrucker?"printer":"box"} size={14}/>{ortVon(akt.s,akt.imDrucker)}
        {akt.s.gewogenAm&&<><span style={{color:TEXT_MUTED}}>·</span><Icon name="scale" size={14}/>gewogen {gewogenText(akt.s.gewogenAm)}</>}
      </div>}
    </div>

    <div style={{display:"flex",gap:8,margin:"18px 0 18px"}}>
      {akt?<>
        <button onClick={onWiegen} style={kachel}><Icon name="scale" size={22}/>Wiegen</button>
        <button onClick={()=>onRfid(akt.s.id)} style={kachel}><Icon name="nfc" size={22}/>Tag schreiben</button>
        <button onClick={()=>onPlatz(akt.s)} style={kachel}><Icon name={akt.imDrucker?"box":"printer"} size={22}/>{akt.imDrucker?"Ins Lager":"In Drucker"}</button>
      </>:<button onClick={onAddSpool} style={{...kachel,background:TEXT,color:BG,fontWeight:700,fontSize:14,flexDirection:"row",justifyContent:"center"}}><Icon name="plus" size={18}/>Spule hinzufügen</button>}
    </div>

    {spulen.length>0&&<>
      <div style={{...etikett,marginBottom:8}}>{spulen.length} SPULE{spulen.length!==1?"N":""}</div>
      {spulen.map(({s,imDrucker})=>{
        const st=startG(fil,s), p=calcPct(s.weight,st), aktiv=akt&&s.id===akt.s.id;
        return <button key={s.id} onClick={()=>onSpool(s.id)} style={{...bloss,width:"100%",display:"block",textAlign:"left",background:SURFACE,borderRadius:14,padding:"10px 12px",marginBottom:6,
          boxShadow:aktiv?`inset 0 0 0 1.5px ${farbe}`:"none"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14}}>
            <span style={{color:TEXT_DIM}}><Icon name={imDrucker?"printer":"box"} size={16}/></span>
            <span style={{flex:1,minWidth:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{ortVon(s,imDrucker)}</span>
            <span style={{fontWeight:700,color:p<KNAPP?ROT:TEXT}}>{s.weight} g</span>
          </div>
          <div style={{height:4,background:"#26262c",borderRadius:4,marginTop:8,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${p}%`,background:farbe,borderRadius:4,transition:"width .6s"}}/>
          </div>
        </button>;
      })}
    </>}
    {fil.notes&&<div style={{background:SURFACE,borderRadius:14,padding:"10px 12px",marginTop:4,fontSize:13,color:TEXT_DIM,lineHeight:1.5}}>{fil.notes}</div>}
  </div>;
}

// ── Spule in Drucker / ins Lager ──
function PlatzModal({fil,spool,imDrucker,drucker,fotos,belegt,startDrucker,onMove,onClose}){
  const [ziel,setZiel]=useState(startDrucker||null);
  const [ort,setOrt]=useState(loadCustomLocs()[0]||"Lager");
  const [gewicht,setGewicht]=useState(String(spool.weight));
  function waehleSlot(p,slot){
    const b=slot.belegt;
    if(b&&b.spool.id===spool.id){onClose();return;}
    if(b){
      const wo=belegt[p].anzahl>1?`Slot ${slot.name} von ${p}`:p;
      if(!confirm(`In ${wo} liegt ${b.fil.brand} ${b.fil.colorName} (${b.spool.weight} g).\nErsetzen? Die alte Spule geht ins Lager.`))return;
    }
    onMove({printer:p,slot:slot.name});
  }
  function waehleDrucker(p){
    const plan=belegt[p];
    if(plan.anzahl===1)waehleSlot(p,plan.slots[0]);
    else setZiel(p);
  }
  const kopf=<div style={{display:"flex",alignItems:"center",gap:12}}>
    <Ring hex={fil.colorHex} pct={calcPct(spool.weight,startG(fil,spool))} size={44} dicke={5}/>
    <div><div style={{fontSize:15,fontWeight:600}}>{fil.brand} {fil.colorName}</div>
      <div style={{fontSize:12,color:TEXT_DIM}}>{fil.material} · {spool.weight} g</div></div>
  </div>;
  const btn={...bloss,background:SURFACE2,borderRadius:14,padding:"12px",textAlign:"left",color:TEXT};

  if(ziel){
    const plan=belegt[ziel];
    return <Modal title={ziel} onClose={onClose}>
      {kopf}
      <div style={{fontSize:13,color:TEXT_DIM}}>In welchen Slot?</div>
      {plan.gruppen.map((g,gi)=><div key={gi}>
        {plan.gruppen.length>1&&<div style={{...etikett,marginBottom:6}}>{g.name||"Slots"}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {g.slots.map(s=>{
            const b=s.belegt, selbst=b&&b.spool.id===spool.id;
            return <button key={s.name} onClick={()=>waehleSlot(ziel,s)} style={{...bloss,background:b?SURFACE2:"transparent",border:`1.5px ${b?"solid":"dashed"} ${b?BORDER:"#52525b"}`,
              borderRadius:14,padding:"8px 4px",display:"flex",flexDirection:"column",alignItems:"center",gap:4,opacity:selbst?0.5:1}}>
              <Ring hex={b?.fil.colorHex} pct={b?calcPct(b.spool.weight,startG(b.fil,b.spool)):0} size={34} dicke={4} leer={!b}/>
              <span style={{fontSize:12,fontWeight:700}}>{s.name}</span>
              <span style={{fontSize:10,color:b?TEXT_DIM:MINT}}>{selbst?"hier":b?`${b.spool.weight} g`:"frei"}</span>
            </button>;
          })}
        </div>
      </div>)}
      <button onClick={()=>setZiel(null)} style={{...bloss,color:TEXT_DIM,fontSize:13,padding:"6px 0"}}>‹ anderer Drucker</button>
    </Modal>;
  }

  return <Modal title={imDrucker?"Ins Lager":"In Drucker einlegen"} onClose={onClose}>
    {kopf}
    {imDrucker&&<div style={{background:SURFACE2,borderRadius:14,padding:12,display:"flex",flexDirection:"column",gap:10}}>
      <Field label="LAGERORT"><LocationCombo value={ort} onChange={setOrt}/></Field>
      <Field label="RESTGEWICHT (g)"><input style={inputStyle} type="number" value={gewicht} onChange={e=>setGewicht(e.target.value)}/></Field>
      <button onClick={()=>onMove({location:ort||"Lager",weight:parseInt(gewicht)||0})} style={{...bloss,background:TEXT,color:BG,borderRadius:12,padding:"12px 0",fontWeight:700,fontSize:14,textAlign:"center"}}>Ins Lager legen</button>
    </div>}
    <div style={{...etikett,marginTop:imDrucker?6:0}}>{imDrucker?"ODER IN ANDEREN DRUCKER":"DRUCKER WÄHLEN"}</div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
      {drucker.map(p=>{
        const plan=belegt[p], frei=plan.slots.filter(s=>!s.belegt).length;
        return <button key={p} onClick={()=>waehleDrucker(p)} style={{...btn,display:"flex",alignItems:"center",gap:10,minWidth:0}}>
          <DruckerFoto src={fotos&&fotos[p]} size={36}/>
          <div style={{minWidth:0}}>
            <div style={{fontSize:14,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p}</div>
            <div style={{fontSize:11,color:frei?MINT:TEXT_MUTED,marginTop:2}}>{plan.anzahl===1?(frei?"frei":"belegt"):`${frei} von ${plan.anzahl} frei`}</div>
          </div>
        </button>;
      })}
    </div>
    {drucker.length===0&&<div style={{fontSize:12,color:TEXT_MUTED}}>Noch keine Drucker – in ⚙️ anlegen.</div>}
  </Modal>;
}

// ── Leeren Slot füllen: Spule aus dem Lager wählen ──
function SlotFuellenModal({drucker,slot,mehrereSlots,filaments,onPick,onClose}){
  const [q,setQ]=useState("");
  const such=q.trim().toLowerCase();
  const liste=[];
  for(const fil of filaments)for(const s of fil.stock||[]){
    if(such&&!`${fil.brand} ${fil.colorName} ${fil.material} ${s.location}`.toLowerCase().includes(such))continue;
    liste.push({fil,s});
  }
  liste.sort((a,b)=>`${a.fil.material} ${a.fil.brand} ${a.fil.colorName}`.localeCompare(`${b.fil.material} ${b.fil.brand} ${b.fil.colorName}`));
  return <Modal title={mehrereSlots?`${drucker} · ${slot}`:drucker} onClose={onClose}>
    <div style={{fontSize:13,color:TEXT_DIM}}>Welche Spule aus dem Lager einlegen?</div>
    <input style={inputStyle} value={q} onChange={e=>setQ(e.target.value)} placeholder="Suchen: Farbe, Marke, Material…"/>
    {liste.length===0&&<div style={{fontSize:13,color:TEXT_MUTED,textAlign:"center",padding:"16px 0"}}>Keine passende Spule im Lager.</div>}
    {liste.map(({fil,s})=><button key={s.id} onClick={()=>onPick(fil.id,s.id)} style={{...bloss,display:"flex",alignItems:"center",gap:12,background:SURFACE2,borderRadius:14,padding:"8px 12px",textAlign:"left"}}>
      <Ring hex={fil.colorHex} pct={calcPct(s.weight,startG(fil,s))} size={36} dicke={4}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:14,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fil.colorName||"—"} <span style={{color:TEXT_DIM,fontWeight:400}}>{fil.brand}</span></div>
        <div style={{fontSize:11,color:TEXT_MUTED}}>{fil.material} · {s.location||"Lager"}</div>
      </div>
      <span style={{fontSize:13,fontWeight:700}}>{s.weight} g</span>
    </button>)}
  </Modal>;
}

// ── Scannen (großer Knopf in der Mitte) ──
function ScanSheet({onNeu,onQR,onClose}){
  const option={...bloss,display:"flex",alignItems:"center",gap:14,background:SURFACE2,borderRadius:16,padding:"14px 16px",textAlign:"left",width:"100%"};
  const titel=(t,u)=><div><div style={{fontSize:15,fontWeight:600}}>{t}</div><div style={{fontSize:12,color:TEXT_DIM,marginTop:2}}>{u}</div></div>;
  return <Modal title="Scannen" onClose={onClose}>
    <button onClick={onNeu} style={option}><Icon name="plus" size={26}/>{titel("Neue Spule anlegen","Etikett scannen oder von Hand eintragen")}</button>
    <button onClick={onQR} style={option}><Icon name="qr" size={26}/>{titel("QR-Code Lagerplatz scannen","Zeigt, was an diesem Lagerplatz liegt")}</button>
  </Modal>;
}

// Spürbares Klicken: Android über vibrate(); das iPhone kennt das nicht, Safari (ab iOS 18)
// gibt aber beim Umschalten eines <input type="checkbox" switch> ein kurzes Tick – das nutzen wir.
let haptikLabel=null;
function haptik(){
  try{
    if(navigator.vibrate){navigator.vibrate(4);return;}
    if(!haptikLabel){
      haptikLabel=document.createElement("label");
      const cb=document.createElement("input");
      cb.type="checkbox";cb.setAttribute("switch","");
      haptikLabel.appendChild(cb);
      haptikLabel.style.cssText="position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
      document.body.appendChild(haptikLabel);
    }
    haptikLabel.click();
  }catch{}
}

// Ratschen-Klick (wie ein Schnurrad): kurzes, gefiltertes Rauschen über Web Audio.
// Funktioniert auch während des Drehens. iPhone im Lautlos-Modus → stumm.
let tonCtx=null, tonRauschen=null, tonZuletzt=0;
function tonBereit(){
  try{
    if(!tonCtx){
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;
      tonCtx=new AC();
      tonRauschen=tonCtx.createBuffer(1,Math.floor(tonCtx.sampleRate*0.02),tonCtx.sampleRate);
      const d=tonRauschen.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
    }
    if(tonCtx.state==="suspended")tonCtx.resume();
  }catch{}
}
function ratsche(){
  try{
    if(!tonCtx||tonCtx.state!=="running")return;
    const jetzt=performance.now();if(jetzt-tonZuletzt<28)return;tonZuletzt=jetzt;
    const t=tonCtx.currentTime;
    const q=tonCtx.createBufferSource();q.buffer=tonRauschen;
    const f=tonCtx.createBiquadFilter();f.type="bandpass";f.frequency.value=2600;f.Q.value=1.2;
    const g=tonCtx.createGain();g.gain.setValueAtTime(0.55,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.018);
    q.connect(f);f.connect(g);g.connect(tonCtx.destination);q.start(t);q.stop(t+0.02);
  }catch{}
}

// ── Material-Auswahl als Pappspule ──
// Drehen bis das Material oben (12 Uhr) steht; beim Loslassen rastet das Rad ein.
// Antippen eines Materials dreht es nach oben, Antippen der Nabe übernimmt.
function SpulenRad({eintraege,wert,onWahl,onClose}){
  const n=eintraege.length, step=360/n;
  const S=Math.min(340,(typeof window!=="undefined"?window.innerWidth:400)-32);
  const nabe=Math.round(S*0.2), rand=12;
  const startIdx=Math.max(0,eintraege.findIndex(e=>e.wert===wert));
  const [rot,setRot]=useState(-startIdx*step-60);   // startet leicht verdreht und dreht sich beim Öffnen ein
  const [zieht,setZieht]=useState(false);
  const [offen,setOffen]=useState(false);
  const radRef=useRef(null), drag=useRef(null);
  useEffect(()=>{const t=setTimeout(()=>{setOffen(true);setRot(-startIdx*step);},30);return ()=>clearTimeout(t);},[]);

  const idxVon=r=>((Math.round(-r/step)%n)+n)%n;
  const index=idxVon(rot);
  const akt=eintraege[index];

  function winkel(e){const r=radRef.current.getBoundingClientRect();return Math.atan2(e.clientY-(r.top+r.height/2),e.clientX-(r.left+r.width/2))*180/Math.PI;}
  function abstand(e){const r=radRef.current.getBoundingClientRect();return Math.hypot(e.clientX-(r.left+r.width/2),e.clientY-(r.top+r.height/2));}
  function naechste(ziel){
    // auf das nächste Material einrasten, von der aktuellen Stellung aus auf kürzestem Weg
    return Math.round(ziel/step)*step;
  }
  function down(e){
    e.currentTarget.setPointerCapture(e.pointerId);
    tonBereit();   // Ton darf erst nach einer Berührung starten (Browser-Regel)
    drag.current={w:winkel(e),rot,t:performance.now(),v:0,weg:0,idx:idxVon(rot)};
    setZieht(true);
  }
  function move(e){
    const d=drag.current;if(!d)return;
    const w=winkel(e);let delta=w-d.w;
    if(delta>180)delta-=360;if(delta<-180)delta+=360;
    const jetzt=performance.now();
    d.v=delta/Math.max(1,jetzt-d.t);d.t=jetzt;d.w=w;d.rot+=delta;d.weg+=Math.abs(delta);
    // bei jedem Material, das über 12 Uhr läuft, einmal klicken (direkt im Touch-Ereignis, sonst blockt iOS)
    const i=idxVon(d.rot);if(i!==d.idx){d.idx=i;ratsche();haptik();}
    setRot(d.rot);
  }
  function up(e){
    const d=drag.current;drag.current=null;setZieht(false);
    if(!d)return;
    if(d.weg<3){
      // Antippen: Nabe = übernehmen, sonst angetipptes Material nach oben drehen
      if(abstand(e)<nabe){onWahl(akt.wert);return;}
      const a=winkel(e)+90-d.rot;                       // Winkel im Rad, 0 = oben
      const i=((Math.round(a/step)%n)+n)%n;
      let diff=(-i*step-d.rot)%360;if(diff>180)diff-=360;if(diff<-180)diff+=360;
      setRot(naechste(d.rot+diff));haptik();
      return;
    }
    // Schwung: kurz nachlaufen lassen, dann einrasten
    const nachlauf=Math.max(-200,Math.min(200,d.v*220));
    const ziel=naechste(d.rot+nachlauf);
    // Nachlauf hörbar machen: Klicks im Takt der auslaufenden Drehung (ease-out ≈ 550 ms)
    const schritte=Math.abs(Math.round((ziel-d.rot)/step));
    for(let k=1;k<=schritte;k++)setTimeout(ratsche,550*(1-Math.cbrt(1-k/(schritte+0.5))));
    // iPhone erlaubt das Tick nur beim Loslassen (nicht während der Bewegung) → beim Einrasten immer klicken
    haptik();
    setRot(ziel);
  }

  const schrift=n<=8?16:n<=14?14:12;
  const innen=nabe+14, aussen=S/2-rand-10;
  return <div style={{position:"fixed",inset:0,zIndex:100,background:"rgba(0,0,0,0.78)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:22,padding:16,color:TEXT,...mono}}>
    <div style={{fontSize:13,color:TEXT_DIM,letterSpacing:"0.08em",fontWeight:600}}>MATERIAL WÄHLEN</div>
    <div style={{position:"relative",width:S,height:S+14,transition:"transform .45s cubic-bezier(.2,.9,.25,1.2), opacity .3s",transform:offen?"scale(1)":"scale(.6)",opacity:offen?1:0}}>
      {/* Zeiger auf 12 Uhr */}
      <div style={{position:"absolute",left:"50%",top:0,transform:"translateX(-50%)",zIndex:3,width:0,height:0,
        borderLeft:"11px solid transparent",borderRight:"11px solid transparent",borderTop:`18px solid ${TEXT}`,filter:"drop-shadow(0 2px 3px rgba(0,0,0,.6))"}}/>
      <div ref={radRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{position:"absolute",left:0,top:14,width:S,height:S,borderRadius:"50%",touchAction:"none",cursor:zieht?"grabbing":"grab",userSelect:"none",WebkitUserSelect:"none"}}>
        {/* drehende Pappscheibe */}
        <div style={{position:"absolute",inset:0,borderRadius:"50%",transform:`rotate(${rot}deg)`,
          transition:zieht?"none":"transform .55s cubic-bezier(.15,.85,.3,1.12)",
          background:"repeating-radial-gradient(circle at 50% 50%, #c99f66 0 5px, #bf935a 5px 6.5px)",
          border:`${rand}px solid #8a6438`,boxShadow:"0 24px 60px rgba(0,0,0,.65), inset 0 0 0 2px rgba(0,0,0,.18), inset 0 0 36px rgba(60,35,10,.35)"}}>
          {eintraege.map((e,i)=>{
            const gewaehlt=i===index;
            return <React.Fragment key={e.wert}>
              <div style={{position:"absolute",left:"50%",top:"50%",width:2,height:12,marginLeft:-1,background:"rgba(70,45,15,.45)",
                transform:`rotate(${i*step}deg) translateY(${-(S/2-rand-4)}px)`,transformOrigin:"50% 0"}}/>
              <div style={{position:"absolute",left:"50%",top:"50%",height:schrift+6,marginTop:-(schrift+6)/2,
                transform:`rotate(${i*step-90}deg) translateX(${innen}px)`,transformOrigin:"0 50%",
                width:aussen-innen,display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",overflow:"hidden",
                fontSize:schrift,fontWeight:gewaehlt?800:600,color:gewaehlt?"#1c1206":"rgba(60,38,14,.78)",letterSpacing:"0.02em"}}>
                {e.label}<span style={{fontSize:schrift-3,fontWeight:500,opacity:.7}}>{e.anzahl}</span>
              </div>
            </React.Fragment>;
          })}
        </div>
        {/* Glanz (dreht nicht mit) */}
        <div style={{position:"absolute",inset:0,borderRadius:"50%",pointerEvents:"none",
          background:"radial-gradient(circle at 32% 26%, rgba(255,255,255,.22), transparent 55%)"}}/>
        {/* Nabe mit Auswahl */}
        <div style={{position:"absolute",left:"50%",top:"50%",width:nabe*2,height:nabe*2,marginLeft:-nabe,marginTop:-nabe,borderRadius:"50%",
          background:BG,border:"6px solid #8a6438",boxShadow:"inset 0 4px 14px rgba(0,0,0,.8)",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",textAlign:"center",padding:6,pointerEvents:"none"}}>
          <div style={{fontSize:Math.min(22,nabe/3),fontWeight:800,lineHeight:1.1,wordBreak:"break-word"}}>{akt.label}</div>
          <div style={{fontSize:11,color:TEXT_DIM,marginTop:4}}>{akt.anzahl} Spule{akt.anzahl!==1?"n":""}</div>
        </div>
      </div>
    </div>
    <div style={{fontSize:12,color:TEXT_MUTED}}>Drehen, bis dein Material oben steht</div>
    <div style={{display:"flex",gap:10,width:"100%",maxWidth:S}}>
      <button onClick={onClose} style={{...bloss,flex:1,background:SURFACE2,borderRadius:14,padding:"14px 0",fontWeight:600,fontSize:15,textAlign:"center"}}>Abbrechen</button>
      <button onClick={()=>onWahl(akt.wert)} style={{...bloss,flex:2,background:TEXT,color:BG,borderRadius:14,padding:"14px 0",fontWeight:700,fontSize:15,textAlign:"center"}}>{akt.label} zeigen</button>
    </div>
  </div>;
}

// ── Drucker-Einheiten bearbeiten (Einstellungen) ──
// Foto antippen = neues Foto aufnehmen oder aus der Mediathek wählen
function FotoWahl({src,onWahl}){
  async function gewaehlt(e){
    const datei=e.target.files&&e.target.files[0];
    e.target.value="";
    if(!datei)return;
    try{onWahl(await fotoVerkleinern(datei));}catch(err){alert(err.message);}
  }
  return <label aria-label={src?"Foto ändern":"Foto hinzufügen"} style={{width:44,height:44,borderRadius:11,flexShrink:0,cursor:"pointer",overflow:"hidden",
    display:"flex",alignItems:"center",justifyContent:"center",color:TEXT_MUTED,border:src?"none":`1.5px dashed #52525b`}}>
    {src?<DruckerFoto src={src} size={44}/>:<Icon name="camera" size={18}/>}
    <input type="file" accept="image/*" onChange={gewaehlt} style={{display:"none"}}/>
  </label>;
}

function EinheitenEditor({drucker,einheiten,setEinheiten,fotos,setFotos}){
  const klein={...bloss,fontSize:12,color:TEXT_DIM,border:`1px dashed ${BORDER}`,borderRadius:8,padding:"6px 0",width:"100%",textAlign:"center"};
  return <div style={{display:"flex",flexDirection:"column",gap:8}}>
    {drucker.map(p=>{
      const liste=einheitenVon(einheiten,p);
      const setze=neu=>setEinheiten(e=>({...e,[p]:neu}));
      const summe=liste.reduce((a,e)=>a+Math.max(1,e.slots|0),0);
      return <div key={p} style={{background:SURFACE2,borderRadius:14,padding:"10px 12px",display:"flex",flexDirection:"column",gap:6}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <FotoWahl src={fotos[p]} onWahl={src=>setFotos(f=>({...f,[p]:src}))}/>
          <div style={{flex:1,minWidth:0,fontSize:14,fontWeight:600}}>{p} <span style={{color:TEXT_MUTED,fontWeight:400,fontSize:12}}>· {summe} Slot{summe!==1?"s":""}</span></div>
          {fotos[p]&&<button onClick={()=>setFotos(f=>{const n={...f};delete n[p];return n;})} style={{...bloss,fontSize:12,color:TEXT_MUTED,padding:"4px 0"}}>Foto entfernen</button>}
        </div>
        {liste.map((e,i)=><div key={i} style={{display:"flex",gap:6,alignItems:"center"}}>
          <input style={{...inputStyle,flex:1}} value={e.name} placeholder="Name, z.B. A oder Ext"
            onChange={ev=>setze(liste.map((x,j)=>j===i?{...x,name:ev.target.value}:x))}/>
          <input style={{...inputStyle,width:60,textAlign:"center"}} type="number" min="1" max="16" value={e.slots}
            onChange={ev=>{
              // leer lassen erlaubt (zum Überschreiben), beim Verlassen des Felds wird daraus 1
              const v=ev.target.value;
              setze(liste.map((x,j)=>j===i?{...x,slots:v===""?"":Math.max(1,Math.min(16,parseInt(v)||1))}:x));
            }}
            onBlur={()=>{if(e.slots==="")setze(liste.map((x,j)=>j===i?{...x,slots:1}:x));}}/>
          <span style={{fontSize:11,color:TEXT_MUTED}}>Slots</span>
          {liste.length>1&&<button onClick={()=>setze(liste.filter((_,j)=>j!==i))} aria-label="Einheit entfernen" style={{...bloss,color:ROT,padding:"0 4px"}}><Icon name="trash" size={16}/></button>}
        </div>)}
        <button onClick={()=>{
          // neues AMS vor einzelne Plätze wie "Ext" einsortieren
          const neu={name:String.fromCharCode(65+liste.filter(x=>(x.slots|0)>1).length),slots:4};
          const i=liste.findIndex(x=>(x.slots|0)<=1&&x.name);
          setze(i<0?[...liste,neu]:[...liste.slice(0,i),neu,...liste.slice(i)]);
        }} style={klein}>+ Einheit (z.B. weiteres AMS)</button>
      </div>;
    })}
  </div>;
}

// ── RFID Write Modal ──
function RfidWriteModal({fil,startSpoolId,onClose}){
  const spools=[
    ...(fil.stock||[]).map(s=>({...s,imDrucker:false})),
    ...(fil.inUse||[]).map(u=>({...u,imDrucker:true})),
  ];
  const [spoolId,setSpoolId]=useState(startSpoolId||spools[0]?.id||"");
  const [status,setStatus]=useState(null); // {type:"ok"|"err"|"wait",msg}
  const spool=spools.find(s=>s.id===spoolId)||null;
  // Mit Web NFC (Android) direkt aufs Tag, sonst über die Waage (max. 255 Zeichen).
  const viaScale=!hasWebNFC;
  const full=buildOpenSpool(fil,spool);
  // Über die Waage: aktuelles Filamentgewicht der Spule mitschicken ("rest"). Die Waage
  // berechnet daraus das Leergewicht (gemessen − rest) und schreibt es als spool_weight auf den Tag.
  const withRest=viaScale&&spool?{...full,rest:String(spool.weight)}:full;
  const payload=viaScale?fitPayload(withRest,HA_TEXT_MAX):full;
  const bytes=payloadBytes(payload);
  const limit=viaScale?HA_TEXT_MAX:NTAG_CAPACITY.NTAG215;
  const fits=bytes<=limit;
  const dropped=Object.keys(full).filter(k=>!(k in payload));

  async function writePhone(){
    setStatus({type:"wait",msg:"Handy jetzt an den Tag halten..."});
    try{await writeTagWebNFC(payload);setStatus({type:"ok",msg:"✓ Tag beschrieben"});}
    catch(e){setStatus({type:"err",msg:"Schreiben fehlgeschlagen: "+(e&&e.message?e.message:String(e))});}
  }
  function writeScale(){
    window.location.href=scaleWriteUrl(loadScaleHost(),payload);
  }
  function copyPayload(){
    const {rest,...ohneRest}=payload; // "rest" ist nur für die Waage, nicht für den Tag
    const text=JSON.stringify(ohneRest);
    kopieren(text)
      .then(()=>setStatus({type:"ok",msg:"✓ Kopiert — in NFC Tools: Schreiben → Datensatz hinzufügen → Text → einfügen."}))
      .catch(()=>setStatus({type:"err",msg:"Kopieren nicht möglich."}));
  }

  const [inhalt,setInhalt]=useState(false);
  const haupt={...bloss,display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",borderRadius:14,padding:"13px 0",
    background:TEXT,color:BG,fontWeight:700,fontSize:15,opacity:fits?1:0.4};
  const neben={...bloss,display:"flex",alignItems:"center",justifyContent:"center",gap:8,width:"100%",borderRadius:14,padding:"11px 0",
    background:SURFACE2,color:TEXT_DIM,fontSize:13,opacity:fits?1:0.4};
  const spulenZeile=(id,icon,text,gramm,pct)=>{
    const aktiv=id===spoolId;
    return <button key={id||"ohne"} onClick={()=>setSpoolId(id)} style={{...bloss,display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",
      background:SURFACE2,borderRadius:14,padding:"9px 12px",boxShadow:aktiv?`inset 0 0 0 1.5px ${sichtbareFarbe(hauptfarbe(fil.colorHex))}`:"none"}}>
      {pct!==null?<Ring hex={fil.colorHex} pct={pct} size={30} dicke={4}/>:<Ring size={30} dicke={4} leer/>}
      <span style={{color:TEXT_DIM}}><Icon name={icon} size={16}/></span>
      <span style={{flex:1,minWidth:0,fontSize:14,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",color:aktiv?TEXT:TEXT_DIM}}>{text}</span>
      {gramm!==null&&<span style={{fontSize:14,fontWeight:700,color:aktiv?TEXT:TEXT_DIM}}>{gramm} g</span>}
    </button>;
  };
  return <Modal title="Tag schreiben" onClose={onClose}>
    <div style={{display:"flex",alignItems:"center",gap:12}}>
      <Ring hex={fil.colorHex} pct={spool?calcPct(spool.weight,startG(fil,spool)):0} size={44} dicke={5} leer={!spool}/>
      <div style={{minWidth:0}}>
        <div style={{fontSize:15,fontWeight:600}}>{fil.brand||"—"} {fil.colorName}</div>
        <div style={{fontSize:12,color:TEXT_DIM}}>{[fil.material,fil.diameter&&`${fil.diameter} mm`,`${fil.fullWeight||1000} g`].filter(Boolean).join(" · ")}</div>
      </div>
    </div>

    {spools.length>0&&<>
      <div style={{...etikett,marginTop:4}}>WELCHE SPULE?</div>
      {spools.map(s=>spulenZeile(s.id,s.imDrucker?"printer":"box",s.imDrucker?`${s.printer}${s.slot?" · "+s.slot:""}`:(s.location||"Lager"),
        s.weight,calcPct(s.weight,startG(fil,s))))}
      {spulenZeile("","nfc","Ohne Spulen-ID",null,null)}
      {!spool&&<div style={{fontSize:12,color:TEXT_MUTED,lineHeight:1.5}}>Ohne Spulen-ID kann die Waage das Gewicht später keiner Spule zuordnen.</div>}
    </>}

    {viaScale&&"rest" in payload&&<div style={{display:"flex",gap:10,alignItems:"flex-start",background:SURFACE2,borderRadius:14,padding:"11px 12px"}}>
      <span style={{color:"#facc15",paddingTop:1}}><Icon name="scale" size={20}/></span>
      <div style={{fontSize:13,lineHeight:1.5}}>
        <div style={{fontWeight:600}}>Spule zuerst auf die Waage legen</div>
        <div style={{color:TEXT_DIM,fontSize:12,marginTop:2}}>Die Waage rechnet Gesamtgewicht − {payload.rest} g Filament und speichert das Leergewicht auf dem Tag.</div>
      </div>
    </div>}

    {!fits&&<div style={{fontSize:13,color:ROT,lineHeight:1.5}}>{viaScale
      ?`Zu lang für die Waage (${HA_TEXT_MAX} Zeichen) – Hersteller oder Farbname kürzen.`
      :`Zu groß für NTAG215 (${NTAG_CAPACITY.NTAG215} Bytes) – NTAG216 verwenden.`}</div>}

    {hasWebNFC&&<button onClick={writePhone} disabled={status?.type==="wait"||!fits} style={haupt}><Icon name="nfc" size={20}/>Mit Handy schreiben</button>}
    {viaScale&&<>
      <button onClick={writeScale} disabled={!fits} style={haupt}><Icon name="scale" size={20}/>Über Waage schreiben</button>
      <button onClick={copyPayload} disabled={!fits} style={neben}><Icon name="list" size={17}/>Für NFC Tools kopieren</button>
      <div style={{fontSize:12,color:TEXT_MUTED,textAlign:"center",lineHeight:1.5}}>
        Öffnet die Seite der Waage ({loadScaleHost()}).<br/>Handy muss im selben WLAN sein · Adresse in ⚙️ einstellen.
      </div>
    </>}

    {status&&<div style={{fontSize:13,textAlign:"center",lineHeight:1.5,
      color:status.type==="ok"?MINT:status.type==="err"?ROT:"#facc15"}}>{status.msg}</div>}

    {/* Technische Details eingeklappt: nur bei Bedarf ansehen */}
    <button onClick={()=>setInhalt(x=>!x)} aria-expanded={inhalt} style={{...bloss,display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,color:TEXT_MUTED,padding:"4px 0"}}>
      <span>Tag-Inhalt (OpenSpool) · {bytes} Bytes</span>
      <span style={{display:"inline-block",transform:inhalt?"rotate(180deg)":"none",transition:"transform .25s"}}>▾</span>
    </button>
    {inhalt&&<>
      <pre style={{margin:0,background:BG,border:`1px solid ${fits?BORDER:"#5c1a1a"}`,borderRadius:12,padding:"10px 12px",
        color:TEXT_DIM,fontSize:11,fontFamily:"ui-monospace,Menlo,monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{JSON.stringify(payload,null,1)}</pre>
      {viaScale&&dropped.length>0&&<div style={{fontSize:12,color:TEXT_MUTED}}>Gekürzt auf {HA_TEXT_MAX} Zeichen, weggelassen: {dropped.join(", ")}</div>}
    </>}
  </Modal>;
}

// ── Von Waage übernehmen: Bestätigung ──
function WaageSyncModal({sync,onApply,onClose}){
  const btn={...bloss,width:"100%",borderRadius:14,padding:"13px 0",fontWeight:700,fontSize:15,textAlign:"center"};
  const neben={...btn,background:SURFACE2,color:TEXT_DIM,fontWeight:400,fontSize:14};
  if(sync.fehler)return <Modal title="Von Waage übernehmen" onClose={onClose}>
    <div style={{display:"flex",gap:10,alignItems:"flex-start",background:SURFACE2,borderRadius:14,padding:"12px"}}>
      <span style={{color:ROT,paddingTop:1}}><Icon name="scale" size={20}/></span>
      <div style={{fontSize:14,lineHeight:1.5,color:TEXT_DIM}}>{SCALE_ERRORS[sync.fehler]||"Die Waage hat einen unbekannten Fehler gemeldet."}</div>
    </div>
    <button onClick={onClose} style={neben}>OK</button>
  </Modal>;
  const {fil,spool,ort,neu}=sync;
  const fw=startG(fil,spool);
  const alt=spool.weight;
  const diff=neu-alt;
  const pct=calcPct(neu,fw);
  return <Modal title="Von Waage übernehmen" onClose={onClose}>
    <div style={{textAlign:"center"}}>
      <div style={{fontSize:15,fontWeight:600}}>{fil.brand||"—"} {fil.colorName}</div>
      <div style={{fontSize:12,color:TEXT_DIM,marginTop:4,display:"flex",justifyContent:"center",alignItems:"center",gap:6}}>
        {fil.material}<span style={{color:TEXT_MUTED}}>·</span><Icon name={sync.liste==="inUse"?"printer":"box"} size={14}/>{ort}</div>
    </div>
    <div style={{display:"flex",justifyContent:"center",margin:"4px 0"}}>
      <Ring hex={fil.colorHex} pct={pct} size={168} dicke={13}>
        <div style={{fontSize:38,fontWeight:700,letterSpacing:"-0.03em",lineHeight:1,color:pct<KNAPP?ROT:TEXT}}>{neu}<span style={{fontSize:15,color:TEXT_DIM,fontWeight:500}}> g</span></div>
        <div style={{fontSize:12,color:TEXT_DIM,marginTop:5}}>{pct} % von {fw} g</div>
      </Ring>
    </div>
    <div style={{display:"flex",justifyContent:"center",gap:8,fontSize:13}}>
      <span style={{color:TEXT_MUTED}}>vorher {alt} g</span>
      <span style={{color:TEXT_MUTED}}>·</span>
      <span style={{color:diff<0?"#facc15":diff>0?MINT:TEXT_DIM,fontWeight:600}}>{diff===0?"unverändert":`${diff>0?"+":"−"}${Math.abs(diff)} g`}</span>
    </div>
    <button onClick={onApply} style={{...btn,background:TEXT,color:BG}}>Übernehmen</button>
    <button onClick={onClose} style={neben}>Abbrechen</button>
  </Modal>;
}

// ── Duplicate Detection Modal ──
function DuplicateModal({existing,onMerge,onNew,onClose}){
  return <Modal onClose={onClose} title="Filament bereits vorhanden">
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:SURFACE2,borderRadius:8}}>
      <ColorChip hex={existing.colorHex} size={32}/>
      <div>
        <div style={{...mono,color:TEXT,fontSize:14,fontWeight:700}}>{existing.brand} {existing.colorName}</div>
        <div style={{display:"flex",gap:5,marginTop:3}}>
          <Badge color={MINT}>{existing.material}</Badge>
          <Badge>{existing.diameter}mm</Badge>
          <Badge>{existing.fullWeight}g/Spule</Badge>
        </div>
      </div>
    </div>
    <div style={{...mono,color:TEXT_DIM,fontSize:12,lineHeight:1.6}}>
      Dieser Filament-Typ ist bereits in deiner Liste. Möchtest du die neue Spule dem bestehenden Eintrag hinzufügen oder einen neuen Eintrag anlegen?
    </div>
    <button onClick={onMerge} style={{
      background:TEXT,color:BG,border:"none",borderRadius:8,
      padding:"13px 0",fontWeight:700,fontSize:14,cursor:"pointer",...mono,width:"100%"
    }}>+ Zum bestehenden Eintrag hinzufügen</button>
    <button onClick={onNew} style={{
      background:SURFACE2,color:TEXT,border:`1px solid ${BORDER}`,borderRadius:8,
      padding:"12px 0",fontWeight:400,fontSize:13,cursor:"pointer",...mono,width:"100%"
    }}>Neuen Eintrag anlegen</button>
  </Modal>;
}

// ── Add/Edit Modal ──
function FilamentModal({initial,onSave,onClose,onDelete,printers,onAddPrinter}){
  const fw=initial?.fullWeight||1000;
  const [form,setForm]=useState({
    brand:"",material:"",colorName:"",colorHex:"",
    diameter:"",fullWeight:"",
    stock:[],inUse:[],notes:"",
    ...(initial||{})
  });
  const [scanning,setScanning]=useState(false);
  const [scanError,setScanError]=useState("");
  const [preview,setPreview]=useState(null);
  const [loadPanel,setLoadPanel]=useState(false);
  const [speicherFehler,setSpeicherFehler]=useState("");   // Auswahl-Panel "Lager-Spule in Drucker einlegen"
  const [loadPrinter,setLoadPrinter]=useState(printers[0]||"");
  const [rfid,setRfid]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  const fullW=form.fullWeight||1000;
  // kleines Feld für ein eigenes Startgewicht der Spule (leer = Startgewicht des Filaments)
  const startFeld=(sp,update)=><label style={{...mono,fontSize:11,color:TEXT_MUTED,display:"flex",alignItems:"center",gap:6}}>Start
    <input type="number" value={sp.startWeight||""} placeholder={String(fullW)}
      onChange={e=>update(sp.id,"startWeight",parseInt(e.target.value)||undefined)}
      style={{...inputStyle,width:70,padding:"5px 8px",fontSize:12,borderRadius:8}}/>g</label>;

  // Stock helpers
  function addStock(){setForm(f=>({...f,stock:[...f.stock,{id:genId(),location:"Lager",weight:f.fullWeight||""}]}));}
  function updateStock(id,key,val){setForm(f=>({...f,stock:f.stock.map(s=>s.id===id?{...s,[key]:val}:s)}));}
  function removeStock(id){setForm(f=>({...f,stock:f.stock.filter(s=>s.id!==id)}));}

  // InUse helpers
  function updateInUse(id,key,val){setForm(f=>({...f,inUse:f.inUse.map(u=>u.id===id?{...u,[key]:val}:u)}));}
  function removeInUse(id){setForm(f=>({...f,inUse:f.inUse.filter(u=>u.id!==id)}));}

  // Spule aus dem Lager in einen Drucker einlegen (verschieben, nicht kopieren).
  function loadStockToPrinter(stockId,printer){
    setForm(f=>{
      const spool=f.stock.find(s=>s.id===stockId);
      if(!spool)return f;
      return {...f,
        stock:f.stock.filter(s=>s.id!==stockId),
        inUse:[...f.inUse,(({location,...rest})=>({...rest,printer:printer||printers[0]||""}))(spool)]};
    });
  }
  // Spule aus dem Drucker zurück ins Lager buchen.
  function returnInUseToStock(inUseId){
    setForm(f=>{
      const spool=f.inUse.find(u=>u.id===inUseId);
      if(!spool)return f;
      return {...f,
        inUse:f.inUse.filter(u=>u.id!==inUseId),
        stock:[...f.stock,(({printer,...rest})=>({...rest,location:"Lager"}))(spool)]};
    });
  }

  async function handlePhoto(e){
    const file=e.target.files[0];if(!file)return;
    const apiKey=loadApiKey();
    if(!apiKey){setScanError("Kein API Key. Bitte in ⚙️ eintragen.");return;}
    setScanError("");setScanning(true);
    const reader=new FileReader();
    reader.onload=async()=>{
      const b64=reader.result.split(",")[1];
      setPreview(reader.result);
      try{
        const r=await scanLabel(b64,file.type,"add",apiKey);
        const nw=r.fullWeight||r.totalWeight||form.fullWeight;
        setForm(f=>({...f,
          brand:r.brand||f.brand,
          material:MATERIALS.includes(r.material)?r.material:(r.material||f.material),
          colorName:r.colorName||f.colorName,
          colorHex:r.colorHex||f.colorHex,
          diameter:DIAMETERS.includes(r.diameter)?r.diameter:f.diameter,
          fullWeight:nw,
          notes:r.notes||f.notes,
        }));
      }catch(err){setScanError("Scan fehlgeschlagen: "+err.message);}
      setScanning(false);
    };
    reader.readAsDataURL(file);
  }

  function handleSave(){
    const fehlt=[!form.material&&"Material",!form.diameter&&"Durchmesser",!(form.fullWeight>0)&&"Startgewicht"].filter(Boolean);
    if(fehlt.length){setSpeicherFehler(`Bitte noch angeben: ${fehlt.join(", ")} – oder Etikett scannen.`);return;}
    setSpeicherFehler("");
    // collect new printers
    const allPrinters=[...new Set([...printers,...form.inUse.map(u=>u.printer).filter(Boolean)])];
    onAddPrinter(allPrinters);
    onSave(form);
  }

  const karte={background:SURFACE2,borderRadius:18,padding:14,display:"flex",flexDirection:"column",gap:12};
  const kopfzeile=(icon,text)=><div style={{...etikett,display:"flex",alignItems:"center",gap:6}}><Icon name={icon} size={14}/>{text}</div>;
  const linkBtn={...bloss,fontSize:12,color:TEXT_DIM};
  const plusBtn={...bloss,width:"100%",border:`1.5px dashed #3f3f46`,borderRadius:14,padding:"11px 0",fontSize:13,fontWeight:600,color:TEXT_DIM,textAlign:"center"};
  // Eine Spule als Zeile: Ring, Ort/Drucker, Restgewicht, darunter Start/voll/gewogen
  const spulenZeile=(sp,ortFeld,update,entfernen,extra)=>{
    const st=startG(form,sp);
    return <div key={sp.id} style={{background:BG,borderRadius:14,padding:10,display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"flex",gap:8,alignItems:"flex-end"}}>
        <Ring hex={form.colorHex} pct={calcPct(sp.weight,st)} size={40} dicke={5} leer={!form.colorHex}/>
        <div style={{flex:1,minWidth:0}}>{ortFeld}</div>
        <label style={{width:84,display:"flex",flexDirection:"column",gap:4}}><span style={{...labelCss,marginBottom:0}}>REST (g)</span>
          <input style={{...inputStyle,width:84}} type="number" value={sp.weight} onChange={e=>update(sp.id,"weight",parseInt(e.target.value)||0)} placeholder="Gramm"/></label>
        <button onClick={()=>entfernen(sp.id)} aria-label="Spule entfernen" style={{...bloss,color:ROT,padding:"10px 2px"}}><Icon name="trash" size={18}/></button>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        {startFeld(sp,update)}
        <div style={{display:"flex",gap:14,alignItems:"center"}}>
          {extra}
          <button onClick={()=>update(sp.id,"weight",st)} style={linkBtn}>→ voll ({st} g)</button>
        </div>
      </div>
      {sp.gewogenAm&&<div style={{fontSize:11,color:TEXT_MUTED,display:"flex",alignItems:"center",gap:5}}><Icon name="scale" size={13}/>gewogen {gewogenText(sp.gewogenAm)}</div>}
    </div>;
  };

  return <Modal onClose={onClose} title={initial?.id?"Filament bearbeiten":"Neues Filament"}>
    {!initial?.id&&<div style={{display:"flex",flexDirection:"column",gap:8}}>
      <PhotoButton label="📷 Etikett scannen" onChange={handlePhoto} loading={scanning}/>
      {scanError&&<div style={{color:ROT,fontSize:12}}>{scanError}</div>}
      {preview&&!scanning&&<div style={{display:"flex",alignItems:"center",gap:10}}>
        <img src={preview} alt="" style={{height:46,borderRadius:10}}/>
        <span style={{color:MINT,fontSize:12}}>✓ Scan ok – Felder prüfen</span>
      </div>}
    </div>}

    {/* Filament */}
    <div style={karte}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <Ring hex={form.colorHex} pct={100} size={46} dicke={6} leer={!form.colorHex}/>
        <div style={{minWidth:0}}>
          <div style={{fontSize:16,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{form.colorName||"Neue Farbe"}</div>
          <div style={{fontSize:12,color:TEXT_DIM}}>{[form.brand,form.material,form.diameter&&`${form.diameter} mm`].filter(Boolean).join(" · ")||"Hersteller, Material, Durchmesser"}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="HERSTELLER"><input style={inputStyle} value={form.brand} onChange={e=>set("brand",e.target.value)} placeholder="z.B. Bambu Lab"/></Field>
        <Field label="FARBE"><input style={inputStyle} value={form.colorName} onChange={e=>set("colorName",e.target.value)} placeholder="z.B. Black"/></Field>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="MATERIAL"><MaterialCombo value={form.material} onChange={v=>set("material",v)}/></Field>
        <Field label="FARBCODE">
          {(()=>{
            const colors=Array.isArray(form.colorHex)?form.colorHex:[form.colorHex||""];
            const setColor=(i,v)=>{const arr=[...colors];arr[i]=v;set("colorHex",arr.length===1?arr[0]:arr);};
            const addColor=()=>{if(colors.length<3)set("colorHex",[...colors,"#aaaaaa"]);};
            const removeColor=(i)=>{const arr=colors.filter((_,j)=>j!==i);set("colorHex",arr.length===1?arr[0]:arr);};
            return <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {colors.map((c,i)=>(
                <div key={i} style={{display:"flex",gap:6,alignItems:"center"}}>
                  <label title={c?"Farbe wählen":"noch keine Farbe"} style={{width:38,height:38,borderRadius:"50%",flexShrink:0,cursor:"pointer",position:"relative",
                    background:c||"transparent",border:c?"2px solid rgba(255,255,255,0.15)":"1.5px dashed #52525b",overflow:"hidden"}}>
                    <input type="color" value={c||"#808080"} onChange={e=>setColor(i,e.target.value)} style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}}/>
                  </label>
                  <input style={{...inputStyle,flex:1,minWidth:0,fontSize:13,padding:"10px 8px"}} value={c} placeholder="#1a1a1a" onChange={e=>setColor(i,e.target.value)}/>
                  {colors.length>1&&<button onClick={()=>removeColor(i)} aria-label="Farbe entfernen" style={{...bloss,color:ROT,padding:"0 2px"}}>✕</button>}
                </div>
              ))}
              {colors.length<3&&<button onClick={addColor} style={{...bloss,fontSize:11,color:TEXT_DIM,textAlign:"left"}}>+ weitere Farbe (Multicolor)</button>}
            </div>;
          })()}
        </Field>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="DURCHMESSER">
          <select style={inputStyle} value={form.diameter??""} onChange={e=>set("diameter",e.target.value===""?"":parseFloat(e.target.value))}>
            <option value="">— wählen —</option>
            {DIAMETERS.map(d=><option key={d} value={d}>{d} mm</option>)}
          </select>
        </Field>
        <Field label="STARTGEWICHT (g)"><input style={inputStyle} type="number" value={form.fullWeight??""} placeholder="z.B. 1000" onChange={e=>set("fullWeight",e.target.value===""?"":(parseInt(e.target.value)||0))}/></Field>
      </div>
    </div>

    {/* Lager */}
    <div style={karte}>
      {kopfzeile("box",`IM LAGER · ${form.stock.length}`)}
      {form.stock.map(s=>spulenZeile(s,
        <Field label="LAGERORT"><LocationCombo value={s.location} onChange={v=>updateStock(s.id,"location",v)}/></Field>,
        updateStock,removeStock))}
      <button onClick={addStock} style={plusBtn}>+ Spule ins Lager</button>
    </div>

    {/* Drucker */}
    <div style={karte}>
      {kopfzeile("printer",`IM DRUCKER · ${form.inUse.length}`)}
      {form.inUse.map(u=>spulenZeile(u,
        <Field label="DRUCKER"><PrinterSelect value={u.printer} onChange={v=>updateInUse(u.id,"printer",v)} printers={printers}/></Field>,
        updateInUse,removeInUse,
        <button onClick={()=>returnInUseToStock(u.id)} style={{...linkBtn,color:TEXT}}>↩ ins Lager</button>))}

      {/* Lager-Spule einlegen: Auswahl statt neue Spule erzeugen */}
      {form.stock.length===0
        ? <div style={{fontSize:12,color:TEXT_MUTED,textAlign:"center",padding:"4px 0"}}>Erst eine Spule im Lager anlegen, dann hier einlegen.</div>
        : !loadPanel
          ? <button onClick={()=>{setLoadPrinter(printers[0]||"");setLoadPanel(true);}} style={plusBtn}>+ Lager-Spule in Drucker einlegen</button>
          : <div style={{background:BG,borderRadius:14,padding:12,display:"flex",flexDirection:"column",gap:10}}>
              <div style={{fontSize:14,fontWeight:600}}>Welche Spule einlegen?</div>
              <Field label="DRUCKER"><PrinterSelect value={loadPrinter} onChange={setLoadPrinter} printers={printers}/></Field>
              {form.stock.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:SURFACE2,borderRadius:12}}>
                  <Ring hex={form.colorHex} pct={calcPct(s.weight,startG(form,s))} size={32} dicke={4} leer={!form.colorHex}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.location||"Lager"}</div>
                    <div style={{fontSize:11,color:TEXT_DIM}}>{s.weight} g · {calcPct(s.weight,startG(form,s))} %</div>
                  </div>
                  <button onClick={()=>{loadStockToPrinter(s.id,loadPrinter);setLoadPanel(false);}} style={{...bloss,background:TEXT,color:BG,borderRadius:10,padding:"8px 12px",fontWeight:700,fontSize:13}}>Einlegen</button>
                </div>
              ))}
              <button onClick={()=>setLoadPanel(false)} style={{...linkBtn,padding:"4px 0"}}>Abbrechen</button>
            </div>
      }
    </div>

    {/* Notes */}
    <Field label="NOTIZEN (Z.B. DRUCKTEMPERATUR)">
      <textarea style={{...inputStyle,height:76,resize:"none",lineHeight:1.6}} value={form.notes||""} onChange={e=>set("notes",e.target.value)} placeholder="z.B. Temp: 220-230°C, Hotbed: 60-70°C"/>
    </Field>

    {speicherFehler&&<div style={{color:ROT,fontSize:13,textAlign:"center",lineHeight:1.5}}>{speicherFehler}</div>}
    <button onClick={handleSave} style={{...bloss,background:TEXT,color:BG,borderRadius:14,padding:"15px 0",fontWeight:700,fontSize:16,width:"100%",textAlign:"center",marginTop:2}}>Speichern</button>
    <button onClick={()=>setRfid(true)} style={{...bloss,background:SURFACE2,color:TEXT,borderRadius:14,padding:"13px 0",fontWeight:600,fontSize:14,width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
      <Icon name="nfc" size={18}/>RFID-Tag schreiben</button>
    {rfid&&<RfidWriteModal fil={form} onClose={()=>setRfid(false)}/>}
    {initial?.id&&onDelete&&<button onClick={()=>{if(confirm("Filament löschen?"))onDelete(initial.id);}} style={{...bloss,color:ROT,fontSize:14,fontWeight:600,padding:"8px 0",display:"flex",alignItems:"center",justifyContent:"center",gap:6,width:"100%"}}>
      <Icon name="trash" size={16}/>Filament löschen</button>}
  </Modal>;
}

// ── Settings Modal ──
function SettingsModal({onClose,printers,einheiten,fotos,statistik,onSavePrinters,onSaveEinheiten,onSaveFotos,onSaveOrte,allFilaments,onImport}){
  const [key,setKey]=useState(loadApiKey());
  const [saved,setSaved]=useState(false);
  const [copied,setCopied]=useState(false);
  const [showKey,setShowKey]=useState(false);
  const [printerList,setPrinterList]=useState(printers.join("\n"));
  const [scaleHost,setScaleHost]=useState(loadScaleHost());
  const [einh,setEinh]=useState(einheiten);
  const [fotosNeu,setFotosNeu]=useState(fotos);
  const [beruehrung,setBeruehrung]=useState(beruehrungAn);
  // Lagerorte: gespeicherte Liste + alle, die an Spulen vorkommen. alt = bisheriger Name (null = neu)
  const [orte,setOrte]=useState(()=>{
    const namen=[...new Set([...loadCustomLocs(),...allFilaments.flatMap(f=>(f.stock||[]).map(s=>s.location))])]
      .filter(o=>o&&o!=="Lager").sort((a,b)=>a.localeCompare(b,"de"));
    return namen.map(o=>({alt:o,neu:o}));
  });
  const ortAnzahl=o=>allFilaments.reduce((a,f)=>a+(f.stock||[]).filter(s=>s.location===o).length,0);
  const druckerNeu=printerList.split("\n").map(p=>p.trim()).filter(Boolean);

  function handleSave(){
    saveApiKey(key.trim());
    saveScaleHost(scaleHost.trim().replace(/^https?:\/\//,"").replace(/\/+$/,""));
    onSavePrinters(druckerNeu);
    // nur Einheiten der aktuellen Drucker behalten
    onSaveEinheiten(Object.fromEntries(druckerNeu.filter(p=>einh[p]).map(p=>[p,einh[p]])));
    onSaveFotos(Object.fromEntries(druckerNeu.filter(p=>fotosNeu[p]).map(p=>[p,fotosNeu[p]])));
    onSaveOrte(orte.map(o=>({alt:o.alt,neu:o.neu.trim()})));
    setSaved(true);setTimeout(()=>setSaved(false),1500);
  }
  function handleCopy(){
    if(!key){return;}
    kopieren(key).then(()=>{
      setCopied(true);setTimeout(()=>setCopied(false),2000);
    }).catch(()=>{});
  }

  const zahl=(w,l)=><div style={{flex:1,background:SURFACE2,borderRadius:14,padding:"10px 12px"}}>
    <div style={{fontSize:20,fontWeight:700}}>{w}</div><div style={{fontSize:11,color:TEXT_MUTED}}>{l}</div></div>;
  return <Modal title="Einstellungen" onClose={onClose}>
    <div style={{display:"flex",gap:8}}>
      {zahl(`${(statistik.kg||0).toLocaleString("de-DE",{maximumFractionDigits:1})} kg`,"Filament gesamt")}
      {zahl(statistik.spulen,"Spulen")}
      {zahl(statistik.materialien,"Materialien")}
    </div>
    <Field label="DRUCKER (EINER PRO ZEILE)">
      <textarea style={{...inputStyle,height:110,resize:"none",lineHeight:1.6}} value={printerList} onChange={e=>setPrinterList(e.target.value)}/>
    </Field>
    <Field label="FOTO UND SLOTS JE DRUCKER (AMS, INDX, EXTERNE SPULE)">
      <EinheitenEditor drucker={druckerNeu} einheiten={einh} setEinheiten={setEinh} fotos={fotosNeu} setFotos={setFotosNeu}/>
    </Field>
    <Field label="LAGERORTE (UMBENENNEN ÄNDERT ALLE SPULEN MIT)">
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {orte.map((o,i)=>{
          const anzahl=o.alt?ortAnzahl(o.alt):0;
          return <div key={i} style={{display:"flex",gap:8,alignItems:"center"}}>
            <input style={{...inputStyle,flex:1}} value={o.neu} placeholder="z.B. Regal A"
              onChange={e=>setOrte(l=>l.map((x,j)=>j===i?{...x,neu:e.target.value}:x))}/>
            <span style={{fontSize:11,color:TEXT_MUTED,width:58,textAlign:"right",flexShrink:0}}>{anzahl} Spule{anzahl!==1?"n":""}</span>
            {anzahl===0
              ?<button onClick={()=>setOrte(l=>l.filter((_,j)=>j!==i))} aria-label="Lagerort löschen" style={{...bloss,color:ROT,padding:"0 4px",flexShrink:0}}><Icon name="trash" size={16}/></button>
              :<span style={{width:24,flexShrink:0}}/>}
          </div>;
        })}
        <button onClick={()=>setOrte(l=>[...l,{alt:null,neu:""}])} style={{...bloss,fontSize:12,color:TEXT_DIM,border:`1px dashed ${BORDER}`,borderRadius:8,padding:"8px 0",width:"100%",textAlign:"center"}}>+ Lagerort</button>
        <div style={{fontSize:11,color:TEXT_MUTED}}>Orte mit Spulen lassen sich nur umbenennen – zum Löschen erst die Spulen umlagern.</div>
      </div>
    </Field>
    <div style={{...mono,fontSize:11,lineHeight:1.8,background:"#0d0d10",border:"1px solid #2a2a31",borderRadius:12,padding:"10px 12px"}}>
      <div style={{color:MINT,fontWeight:700,marginBottom:4}}>API-Key (Anthropic)</div>
      <div style={{color:TEXT_DIM,marginBottom:8}}>Der Key wird für die KI-Etikettenerkennung im Scan-Tab verwendet. Claude analysiert das Foto und extrahiert automatisch Hersteller, Material, Farbe und Gewicht.</div>
      <div style={{color:TEXT,marginBottom:2}}>Wo bekommst du den Key?</div>
      <div style={{color:TEXT_DIM,paddingLeft:8,marginBottom:8}}>
        → <span style={{color:TEXT}}>console.anthropic.com</span><br/>
        → Account erstellen → API Keys → Create Key<br/>
        <span style={{color:"#facc15"}}>Zum Starten reichen 5 € — ein Scan kostet ca. 0,02 €.</span>
      </div>
      <div style={{color:TEXT,marginBottom:2}}>Sicherheit</div>
      <div style={{color:TEXT_DIM,paddingLeft:8}}>Der Key wird nur in deinem Browser gespeichert und nie an einen eigenen Server gesendet. Anfragen gehen direkt von deinem Gerät an Anthropic.</div>
    </div>
    <Field label="ANTHROPIC API KEY">
      <div style={{display:"flex",gap:6}}>
        <input style={{...inputStyle,flex:1}} type={showKey?"text":"password"} value={key} onChange={e=>setKey(e.target.value)} placeholder="sk-ant-..."/>
        <button onClick={()=>setShowKey(v=>!v)} style={{background:SURFACE2,color:TEXT_DIM,border:`1px solid ${BORDER}`,borderRadius:6,padding:"0 10px",cursor:"pointer",fontSize:13,flexShrink:0}}>
          {showKey?"🙈":"👁"}
        </button>
        <button onClick={handleCopy} style={{
          background:copied?"#1f3a2a":SURFACE2,color:copied?MINT:TEXT_DIM,
          border:`1px solid ${copied?MINT:BORDER}`,borderRadius:6,padding:"0 10px",
          cursor:"pointer",fontSize:12,...mono,flexShrink:0,transition:"all 0.2s"
        }}>{copied?"✓":"Kopieren"}</button>
      </div>
    </Field>
    <button onClick={()=>{
        const neu=!beruehrung;
        try{localStorage.setItem(BERUEHRUNG_KEY,neu?"1":"0");}catch{}
        window.dispatchEvent(new Event("beruehrungen"));
        setBeruehrung(neu);
      }} style={{...bloss,display:"flex",alignItems:"center",gap:12,background:SURFACE2,borderRadius:14,padding:"12px 14px",textAlign:"left",width:"100%"}}>
      <div style={{flex:1}}>
        <div style={{fontSize:14,fontWeight:600}}>Berührungen anzeigen</div>
        <div style={{fontSize:12,color:TEXT_DIM,marginTop:2}}>Für Bildschirmaufnahmen: zeigt einen Kreis, wo du tippst</div>
      </div>
      <span style={{width:46,height:28,borderRadius:99,background:beruehrung?"#4ade80":"#3f3f46",position:"relative",flexShrink:0,transition:"background .2s"}}>
        <span style={{position:"absolute",top:3,left:beruehrung?21:3,width:22,height:22,borderRadius:"50%",background:"#fff",transition:"left .2s"}}/>
      </span>
    </button>
    <Field label="WAAGE-ADRESSE (RFID SCHREIBEN)">
      <input style={inputStyle} value={scaleHost} onChange={e=>setScaleHost(e.target.value)} placeholder={DEFAULT_SCALE_HOST}/>
      <span style={{...mono,color:TEXT_MUTED,fontSize:9,marginTop:3}}>ESPHome-Name + .local oder IP, z.B. spulenwaage.local oder 192.168.1.50</span>
    </Field>
    <button onClick={handleSave} style={{
      background:saved?"#1f3a2a":TEXT,color:saved?MINT:BG,border:saved?`1px solid ${MINT}`:"none",
      borderRadius:14,padding:"14px 0",fontWeight:700,fontSize:15,cursor:"pointer",...mono,width:"100%"
    }}>{saved?"✓ Gespeichert":"Speichern"}</button>
    <div style={{...mono,color:TEXT_MUTED,fontSize:11,textAlign:"center"}}>API-Key wird nur auf diesem Gerät gespeichert · {VERSION}</div>

    <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
      <div style={{...mono,color:TEXT_DIM,fontSize:10,letterSpacing:"0.08em"}}>BACKUP</div>
      <button onClick={()=>exportBackup(allFilaments,printers,einheiten)} style={{
        ...mono,background:SURFACE2,color:MINT,border:`1px solid ${BORDER}`,
        borderRadius:8,padding:"11px 0",fontSize:13,cursor:"pointer",width:"100%"
      }}>⬇ Backup exportieren</button>
      <label style={{
        ...mono,background:SURFACE2,color:"#60a5fa",border:`1px solid ${BORDER}`,
        borderRadius:8,padding:"11px 0",fontSize:13,cursor:"pointer",width:"100%",
        display:"block",textAlign:"center"
      }}>
        ⬆ Backup importieren
        <input type="file" accept=".json" onChange={e=>{
          const file=e.target.files[0];if(!file)return;
          importBackup(file,data=>{
            if(window.confirm(`Backup vom ${data.exported?.slice(0,10)} laden? Aktuelle Daten werden ersetzt.`)){
              onImport(data.filaments,data.printers||printers,data.einheiten);
              setSaved(true);setTimeout(()=>setSaved(false),1500);
            }
          },err=>alert("Import fehlgeschlagen: "+err));
          e.target.value="";
        }} style={{display:"none"}}/>
      </label>
      {saved&&<div style={{...mono,color:MINT,fontSize:11,textAlign:"center"}}>✓ Import erfolgreich</div>}
    </div>
  </Modal>;
}

// ── Aufnahme-Modus: Berührungen sichtbar machen ──
// iPhone-Bildschirmaufnahmen zeigen nicht, wo getippt wird. Ist der Modus an (Einstellungen),
// zeichnet die App bei jeder Berührung einen Kreis mit Welle; beim Ziehen folgt ein Punkt dem Finger.
const BERUEHRUNG_KEY="beruehrungen_zeigen";
function beruehrungAn(){try{return localStorage.getItem(BERUEHRUNG_KEY)==="1";}catch{return false;}}
function BeruehrungsAnzeige(){
  const [an,setAn]=useState(beruehrungAn);
  const [wellen,setWellen]=useState([]);
  const [finger,setFinger]=useState(null);
  useEffect(()=>{
    const umschalten=()=>setAn(beruehrungAn());
    window.addEventListener("beruehrungen",umschalten);
    return ()=>window.removeEventListener("beruehrungen",umschalten);
  },[]);
  useEffect(()=>{
    if(!an)return;
    let unten=false;
    const runter=e=>{
      unten=true;
      const w={id:Math.random(),x:e.clientX,y:e.clientY};
      setWellen(l=>[...l,w]);
      setTimeout(()=>setWellen(l=>l.filter(x=>x.id!==w.id)),600);
      setFinger({x:e.clientX,y:e.clientY});
    };
    const zieh=e=>{if(unten)setFinger({x:e.clientX,y:e.clientY});};
    const hoch=()=>{unten=false;setFinger(null);};
    // capture: auch Berührungen sehen, die Bedienelemente selbst abfangen (z.B. das Drehrad)
    window.addEventListener("pointerdown",runter,true);
    window.addEventListener("pointermove",zieh,true);
    window.addEventListener("pointerup",hoch,true);
    window.addEventListener("pointercancel",hoch,true);
    return ()=>{
      window.removeEventListener("pointerdown",runter,true);
      window.removeEventListener("pointermove",zieh,true);
      window.removeEventListener("pointerup",hoch,true);
      window.removeEventListener("pointercancel",hoch,true);
    };
  },[an]);
  if(!an)return null;
  const kreis={position:"fixed",borderRadius:"50%",pointerEvents:"none",zIndex:9999};
  return <>
    {wellen.map(w=><div key={w.id} style={{...kreis,left:w.x-30,top:w.y-30,width:60,height:60,
      border:"3px solid rgba(255,255,255,0.95)",background:"rgba(255,255,255,0.18)",animation:"tippWelle .6s ease-out forwards"}}/>)}
    {finger&&<div style={{...kreis,left:finger.x-19,top:finger.y-19,width:38,height:38,
      background:"rgba(255,255,255,0.35)",border:"2px solid rgba(255,255,255,0.9)",boxShadow:"0 0 18px rgba(255,255,255,0.45)"}}/>}
  </>;
}

// ── Main App ──
function App(){
  const {zoom,isMobile}=useViewport();
  const [filaments,setFilaments]=useState(loadFilaments);
  const [printers,setPrinters]=useState(loadPrinters);
  const [einheiten,setEinheiten]=useState(loadEinheiten);
  const [fotos,setFotos]=useState(loadFotos);
  const [modal,setModal]=useState(null);
  // Für den Start-Wächter in index.html: die App läuft
  useEffect(()=>{window.__appLaeuft=true;},[]);

  // ── Server-Abgleich (nur wenn die App auf dem PocketBase-Server läuft) ──
  const [server,setServer]=useState({modus:"pruefe"}); // pruefe | lokal | ok | fehler
  const filsRef=useRef(filaments); filsRef.current=filaments;
  const printersRef=useRef(printers); printersRef.current=printers;
  const einheitenRef=useRef(einheiten); einheitenRef.current=einheiten;
  const fotosRef=useRef(fotos); fotosRef.current=fotos;
  const stand=useRef(new Map());       // app_id → {rid, json}: so liegt es gerade auf dem Server
  const einstStand=useRef(null);       // {rid, json} der Einstellungen auf dem Server
  const ungespeichert=useRef(false);   // lokale Änderungen, die noch nicht auf dem Server sind
  const warteschlange=useRef(Promise.resolve());
  const offeneMessungen=useRef([]);    // übernommene Waagen-Messungen, die noch gelöscht werden müssen
  const serverAktiv=server.modus==="ok"||server.modus==="fehler";

  // Schreibvorgänge nacheinander ausführen, nie parallel
  function inWarteschlange(arbeit){
    warteschlange.current=warteschlange.current.then(arbeit).catch(e=>setServer({modus:"fehler",msg:e.message}));
    return warteschlange.current;
  }
  // Nur Unterschiede schicken: neue anlegen, geänderte aktualisieren, gelöschte entfernen
  function filamenteHochladen(){
    return inWarteschlange(async()=>{
      const map=stand.current, ids=new Set();
      for(const f of filsRef.current){
        ids.add(f.id);
        const json=JSON.stringify(f), alt=map.get(f.id);
        if(!alt){const r=await pbSchreiben("POST","filamente",null,{app_id:f.id,daten:f});map.set(f.id,{rid:r.id,json});}
        else if(alt.json!==json){await pbSchreiben("PATCH","filamente",alt.rid,{daten:f});alt.json=json;}
      }
      for(const [appId,v] of [...map]){
        if(!ids.has(appId)){await pbSchreiben("DELETE","filamente",v.rid);map.delete(appId);}
      }
      // Messungen erst löschen, wenn ihr Gewicht sicher auf dem Server gespeichert ist
      // (oder sie durch eine neuere Messung derselben Spule ersetzt wurden)
      const behalten=[];
      for(const m of offeneMessungen.current){
        const f=filsRef.current.find(x=>[...(x.stock||[]),...(x.inUse||[])].some(sp=>sp.id===m.spool_id));
        const sp=f&&[...(f.stock||[]),...(f.inUse||[])].find(x=>x.id===m.spool_id);
        const ersetzt=offeneMessungen.current.some(o=>o.spool_id===m.spool_id&&o.created>m.created);
        const gespeichert=!f||(sp.weight===m.gramm&&map.get(f.id)?.json===JSON.stringify(f));
        if(ersetzt||gespeichert){try{await pbSchreiben("DELETE","messungen",m.id);}catch{}}
        else behalten.push(m);
      }
      offeneMessungen.current=behalten;
      ungespeichert.current=false;
      setServer(s=>s.modus==="ok"?s:{modus:"ok"});
    });
  }
  function einstellungenHochladen(){
    return inWarteschlange(async()=>{
      const daten={drucker:printersRef.current,einheiten:einheitenRef.current,fotos:fotosRef.current,materialien:loadCustomMats(),lagerorte:loadCustomLocs()};
      const json=JSON.stringify(daten);
      if(einstStand.current&&einstStand.current.json===json)return;
      if(einstStand.current){await pbSchreiben("PATCH","einstellungen",einstStand.current.rid,{daten});einstStand.current.json=json;}
      else{const r=await pbSchreiben("POST","einstellungen",null,{name:"allgemein",daten});einstStand.current={rid:r.id,json};}
    });
  }
  // Einstellungen vom Server übernehmen: Drucker ersetzen, Materialien/Lagerorte zusammenführen
  function einstellungenUebernehmen(rec){
    const d=rec.daten||{};
    if(Array.isArray(d.drucker)&&d.drucker.length)setPrinters(d.drucker);
    if(d.einheiten&&typeof d.einheiten==="object"&&!Array.isArray(d.einheiten))setEinheiten(d.einheiten);
    if(d.fotos&&typeof d.fotos==="object"&&!Array.isArray(d.fotos))setFotos(d.fotos);
    const vereinen=(key,liste)=>{
      if(!Array.isArray(liste))return;
      let cur=[];try{cur=JSON.parse(localStorage.getItem(key)||"[]");}catch{}
      localStorage.setItem(key,JSON.stringify([...new Set([...cur,...liste])]));
    };
    vereinen("custom_materials",d.materialien);
    // Lagerorte vom Server ersetzen die eigenen (sonst kämen gelöschte/umbenannte Orte zurück)
    if(Array.isArray(d.lagerorte))localStorage.setItem("custom_locations",JSON.stringify(d.lagerorte));
    einstStand.current={rid:rec.id,json:JSON.stringify(d)};
  }

  // Neue Messungen der Waage übernehmen (bereits übernommene nicht doppelt)
  function messungenEinarbeiten(fils,messungen){
    const bekannt=new Set(offeneMessungen.current.map(m=>m.id));
    const neu=messungen.filter(m=>!bekannt.has(m.id));
    if(!neu.length)return fils;
    offeneMessungen.current.push(...neu.map(m=>({id:m.id,spool_id:m.spool_id,created:String(m.created||""),gramm:Math.max(0,Math.round(m.gramm||0))})));
    return messungenAnwenden(fils,neu);
  }

  // Beim Start: Läuft die App auf dem Server? Dann Stand vom Server holen.
  useEffect(()=>{(async()=>{
    if(!(await pbVerfuegbar())){setServer({modus:"lokal"});return;}
    try{
      const [{stand:s,fils},einst,messungen]=await Promise.all([pbFilamenteLaden(),pbAlle("einstellungen"),pbAlle("messungen")]);
      const rec=einst.find(r=>r.name==="allgemein");
      if(rec)einstellungenUebernehmen(rec);
      stand.current=s;
      if(s.size===0&&filsRef.current.length>0){
        // Server noch leer, dieses Gerät hat aber Daten → als Startbestand hochladen?
        if(!window.confirm(`Der Server ist noch leer. Die ${filsRef.current.length} Filamente dieses Geräts hochladen?`))setFilaments([]);
      }else{
        setFilaments(messungenEinarbeiten(fils,messungen));
      }
      einstellungenGeaendert=()=>einstellungenHochladen();
      setServer({modus:"ok"});
    }catch(e){setServer({modus:"fehler",msg:e.message});}
  })();},[]);

  // Speichern: immer lokal (Zwischenspeicher), im Server-Betrieb zusätzlich zum Server
  useEffect(()=>{
    saveFilaments(filaments);
    if(!serverAktiv)return;
    ungespeichert.current=true;
    const t=setTimeout(filamenteHochladen,400);
    return ()=>clearTimeout(t);
  },[filaments,serverAktiv]);
  useEffect(()=>{
    savePrinters(printers);
    saveEinheiten(einheiten);
    saveFotos(fotos);
    if(!serverAktiv)return;
    const t=setTimeout(einstellungenHochladen,400);
    return ()=>clearTimeout(t);
  },[printers,einheiten,fotos,serverAktiv]);

  // Lagerorte und eigene Materialien aus den vorhandenen Spulen in die Auswahllisten übernehmen
  // (z.B. nach einem Backup-Import, der diese Listen nicht enthält)
  useEffect(()=>{
    for(const f of filaments){
      if(f.material)saveCustomMat(f.material);
      for(const s of f.stock||[])if(s.location&&s.location!=="Lager")saveCustomLoc(s.location);
    }
  },[filaments]);

  // Änderungen anderer Geräte holen: alle 15 s und sobald die App wieder im Vordergrund ist
  useEffect(()=>{
    if(!serverAktiv)return;
    let laeuft=false;
    async function holen(){
      if(laeuft)return;
      laeuft=true;
      try{
        if(ungespeichert.current){await filamenteHochladen();return;}
        const [{stand:s,fils},einst,messungen]=await Promise.all([pbFilamenteLaden(),pbAlle("einstellungen"),pbAlle("messungen")]);
        if(ungespeichert.current)return;   // währenddessen lokal geändert → nichts überschreiben
        stand.current=s;
        const mitMessungen=messungenEinarbeiten(fils,messungen);
        if(JSON.stringify(mitMessungen)!==JSON.stringify(filsRef.current))setFilaments(mitMessungen);
        const rec=einst.find(r=>r.name==="allgemein");
        if(rec&&(!einstStand.current||JSON.stringify(rec.daten)!==einstStand.current.json))einstellungenUebernehmen(rec);
        setServer(x=>x.modus==="ok"?x:{modus:"ok"});
      }catch(e){
        setServer({modus:"fehler",msg:e.message});
      }finally{
        laeuft=false;
      }
    }
    const iv=setInterval(holen,15000);
    const sichtbar=()=>{if(document.visibilityState==="visible")holen();};
    document.addEventListener("visibilitychange",sichtbar);
    window.addEventListener("focus",sichtbar);
    return ()=>{
      clearInterval(iv);
      document.removeEventListener("visibilitychange",sichtbar);
      window.removeEventListener("focus",sichtbar);
    };
  },[serverAktiv]);

  function handleSave(form){
    if(form.id){
      // Editing existing — just save
      setFilaments(f=>f.map(x=>x.id===form.id?form:x));
      setModal(null);
      return;
    }
    // New entry — check for duplicates
    const match=filaments.find(f=>
      f.brand?.toLowerCase()===form.brand?.toLowerCase()&&
      f.material?.toLowerCase()===form.material?.toLowerCase()&&
      f.colorName?.toLowerCase()===form.colorName?.toLowerCase()
    );
    if(match){
      setDupeCheck({existing:match,newForm:form});
      setModal(null);
    } else {
      setFilaments(f=>[...f,{...form,id:genId(),addedAt:Date.now()}]);
      setModal(null);
    }
  }

  function handleMerge(){
    if(!dupeCheck)return;
    const {existing,newForm}=dupeCheck;
    // Add all stock and inUse from newForm to existing
    const merged={
      ...existing,
      stock:[...(existing.stock||[]),...(newForm.stock||[])],
      inUse:[...(existing.inUse||[]),...(newForm.inUse||[])],
    };
    setFilaments(f=>f.map(x=>x.id===existing.id?merged:x));
    setDupeCheck(null);
  }

  function handleForceNew(){
    if(!dupeCheck)return;
    const {newForm}=dupeCheck;
    setFilaments(f=>[...f,{...newForm,id:genId(),addedAt:Date.now()}]);
    setDupeCheck(null);
  }
  // Spule in einen Drucker-Slot legen oder ins Lager zurück.
  // ziel: {printer,slot} oder {location,weight}. Liegt im Ziel-Slot schon eine Spule, geht sie ins Lager.
  function verschieben(filId,spoolId,ziel){
    setFilaments(fs=>{
      let spool=null;
      let neu=fs.map(f=>{
        if(f.id!==filId)return f;
        const s=spulenVon(f).find(x=>x.id===spoolId);
        if(!s)return f;
        spool=s;
        return {...f,stock:(f.stock||[]).filter(x=>x.id!==spoolId),inUse:(f.inUse||[]).filter(x=>x.id!==spoolId)};
      });
      if(!spool)return fs;
      const {location,printer,slot,...rest}=spool;
      if(ziel.printer){
        // Aktuelle (ggf. automatisch vergebene) Slots des Ziel-Druckers festschreiben
        const plan=belegung(neu,[ziel.printer],einheiten)[ziel.printer];
        const fest=new Map(), raus=new Set();
        for(const sl of plan.slots){
          if(!sl.belegt)continue;
          if(sl.name===ziel.slot)raus.add(sl.belegt.spool.id);else fest.set(sl.belegt.spool.id,sl.name);
        }
        neu=neu.map(f=>{
          if(!(f.inUse||[]).some(u=>fest.has(u.id)||raus.has(u.id)))return f;
          const zurueck=f.inUse.filter(u=>raus.has(u.id)).map(({printer,slot,...r})=>({...r,location:"Lager"}));
          return {...f,
            inUse:f.inUse.filter(u=>!raus.has(u.id)).map(u=>fest.has(u.id)?{...u,slot:fest.get(u.id)}:u),
            stock:[...(f.stock||[]),...zurueck]};
        });
        neu=neu.map(f=>f.id===filId?{...f,inUse:[...(f.inUse||[]),{...rest,printer:ziel.printer,slot:ziel.slot}]}:f);
      }else{
        neu=neu.map(f=>f.id===filId?{...f,stock:[...(f.stock||[]),{...rest,location:ziel.location||"Lager",weight:ziel.weight??rest.weight}]}:f);
      }
      return neu;
    });
  }

  function handleAddPrinter(list){
    setPrinters(list);
  }
  // Lagerorte aus den Einstellungen: umbenannte Orte an allen Spulen ändern, Liste ersetzen
  function orteSpeichern(zeilen){
    const umbenannt=new Map(zeilen.filter(z=>z.alt&&z.neu&&z.neu!==z.alt).map(z=>[z.alt,z.neu]));
    if(umbenannt.size)setFilaments(fs=>fs.map(f=>(f.stock||[]).some(s=>umbenannt.has(s.location))
      ?{...f,stock:f.stock.map(s=>umbenannt.has(s.location)?{...s,location:umbenannt.get(s.location)}:s)}:f));
    localStorage.setItem("custom_locations",JSON.stringify([...new Set(zeilen.map(z=>z.neu).filter(Boolean))]));
    einstellungenGeaendert();
  }

  // ── Ansichten ──
  const [screen,setScreen]=useState("home");      // home | detail | qr
  const [detail,setDetail]=useState(null);        // {filId, spoolId}
  const [filter,setFilter]=useState("Alle");      // Alle | Nachkaufen | <Material>
  const [suche,setSuche]=useState(null);          // null = Suchfeld geschlossen
  const [listenAnsicht,setListenAnsicht]=useState(false);
  const [dupeCheck,setDupeCheck]=useState(null);
  const [platz,setPlatz]=useState(null);          // {filId, spoolId}
  const [slotFuellen,setSlotFuellen]=useState(null); // {printer, slot, mehrere}
  const [rfidFor,setRfidFor]=useState(null);      // {filId, spoolId}
  const [scanSheet,setScanSheet]=useState(false);
  const [radOffen,setRadOffen]=useState(false);

  function zeige(s){setScreen(s);window.scrollTo(0,0);}
  function openDetail(fil,spoolId){setDetail({filId:fil.id,spoolId:spoolId||null});zeige("detail");}

  // ── Kennzahlen ──
  const total=filaments.length;
  const totalSpools=filaments.reduce((a,f)=>a+spulenVon(f).length,0);
  const alleDrucker=[...new Set([...printers,...filaments.flatMap(f=>(f.inUse||[]).map(u=>u.printer)).filter(Boolean)])];
  const belegt=belegung(filaments,alleDrucker,einheiten);
  const nachkaufen=filaments.filter(knapp);
  const usedMats=[...new Set(filaments.map(f=>f.material).filter(Boolean))].sort();
  const gesamtKg=filaments.reduce((a,f)=>a+spulenVon(f).reduce((b,s)=>b+(s.weight||0),0),0)/1000;

  // Ort einer Spule als Text: "Regal A" oder "Bambu H2C · A2"
  function ortVon(s,imDrucker){
    if(!imDrucker)return s.location||"Lager";
    const plan=belegt[s.printer];
    if(!plan||plan.anzahl===1)return s.printer;
    const sl=plan.slots.find(x=>x.belegt&&x.belegt.spool.id===s.id);
    return sl?`${s.printer} · ${sl.name}`:`${s.printer} · ohne Slot`;
  }

  const q=(suche||"").trim().toLowerCase();
  const sichtbar=filaments.filter(f=>{
    if(filter==="Nachkaufen"&&!knapp(f))return false;
    if(filter!=="Alle"&&filter!=="Nachkaufen"&&f.material!==filter)return false;
    if(q&&!`${f.brand} ${f.colorName} ${f.material} ${(f.stock||[]).map(s=>s.location).join(" ")} ${(f.inUse||[]).map(s=>s.printer).join(" ")}`.toLowerCase().includes(q))return false;
    return true;
  });
  // Lager-Kacheln: Filamente mit Lager-Spulen (oder ganz ohne Spulen), die leersten zuerst
  const lager=sichtbar.filter(f=>(f.stock||[]).length>0||!(f.inUse||[]).length)
    .map(f=>({fil:f,spool:repSpule(f)}))
    .sort((a,b)=>(a.spool?a.spool.weight/startG(a.fil,a.spool):0)-(b.spool?b.spool.weight/startG(b.fil,b.spool):0));
  // bei Suche/Filter auch Filamente zeigen, die nur im Drucker liegen
  const nurImDrucker=(q||filter!=="Alle")?sichtbar.filter(f=>!(f.stock||[]).length&&(f.inUse||[]).length):[];

  // ── Gewicht von der Waage übernehmen ──
  const [waageSync,setWaageSync]=useState(null); // {fil,spool,liste,ort,neu} | {fehler}
  const filamentsRef=useRef(filaments);
  filamentsRef.current=filaments;
  function handleScaleResult(raw){
    const r=parseScaleResult(raw);
    if(!r)return;
    if(r.fehler){setWaageSync({fehler:r.fehler});return;}
    const hit=findSpool(filamentsRef.current,r.id);
    setWaageSync(hit?{...hit,neu:r.g}:{fehler:"unbekannt"});
  }
  useEffect(()=>{
    // Rückweg 2: Waage springt zurück mit #waage=<Ergebnis>
    const m=location.hash.match(/^#waage=(.+)$/);
    if(m){
      history.replaceState(null,"",location.pathname+location.search);
      try{handleScaleResult(decodeURIComponent(m[1]));}catch{}
    }
    // Rückweg 1: Waagen-Fenster schickt das Ergebnis per postMessage
    function onMsg(e){
      if(e.origin!==`http://${loadScaleHost()}`)return;
      if(e.data&&e.data.type==="filament-waage")handleScaleResult(e.data.ergebnis);
    }
    window.addEventListener("message",onMsg);
    return ()=>window.removeEventListener("message",onMsg);
  },[]);
  function syncFromScale(){
    if(total===0){alert("Erst Filament anlegen.");return;}
    const url=scaleSyncUrl(loadScaleHost(),location.origin+location.pathname);
    const w=window.open(url,"_blank");
    if(!w)window.location.href=url;
  }
  function applySync(){
    const {fil,spool,liste,neu}=waageSync;
    setFilaments(fs=>fs.map(f=>f.id!==fil.id?f:{...f,[liste]:(f[liste]||[]).map(s=>s.id===spool.id?{...s,weight:neu,gewogenAm:Date.now()}:s)}));
    setDetail({filId:fil.id,spoolId:spool.id});
    zeige("detail");
    setWaageSync(null);
  }

  function slotGeklickt(printer,slot){
    if(slot.belegt)openDetail(slot.belegt.fil,slot.belegt.spool.id);
    else setSlotFuellen({printer,slot:slot.name,mehrere:belegt[printer].anzahl>1});
  }
  function spuleHinzufuegen(fil){
    const neu={id:genId(),location:loadCustomLocs()[0]||"Lager",weight:startG(fil)};
    setFilaments(fs=>fs.map(f=>f.id===fil.id?{...f,stock:[...(f.stock||[]),neu]}:f));
    setDetail({filId:fil.id,spoolId:neu.id});
  }

  const detailFil=screen==="detail"&&detail?filaments.find(f=>f.id===detail.filId):null;
  useEffect(()=>{if(screen==="detail"&&!detailFil)setScreen("home");},[screen,detailFil]);
  const platzFil=platz&&filaments.find(f=>f.id===platz.filId);
  const platzSpule=platzFil&&spulenVon(platzFil).find(s=>s.id===platz.spoolId);
  const rfidFil=rfidFor&&filaments.find(f=>f.id===rfidFor.filId);

  const chip=aktiv=>({...bloss,fontSize:12,padding:"7px 13px",borderRadius:99,whiteSpace:"nowrap",flexShrink:0,
    background:aktiv?TEXT:SURFACE2,color:aktiv?BG:TEXT_DIM,fontWeight:aktiv?700:500});
  const dockBtn=aktiv=>({...bloss,padding:10,color:aktiv?TEXT:TEXT_MUTED,display:"flex",alignItems:"center",justifyContent:"center"});
  const einzel=alleDrucker.filter(p=>belegt[p].anzahl===1);
  const mehrfach=alleDrucker.filter(p=>belegt[p].anzahl>1);

  return <>
  <div style={{background:"#08080a",minHeight:`calc(100vh / ${zoom})`,display:"flex",justifyContent:"center",zoom:zoom}}>
  <div style={{width:"100%",maxWidth:DESIGN_WIDTH,minHeight:`calc(100vh / ${zoom})`,background:BG,color:TEXT,
    paddingBottom:"calc(96px + env(safe-area-inset-bottom))",
    boxShadow:isMobile?"none":"0 0 60px rgba(0,0,0,0.8)",position:"relative"}}>

    {/* ── Startseite ── */}
    {screen==="home"&&<div style={{padding:"calc(18px + env(safe-area-inset-top)) 16px 0"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div>
          <div style={{fontFamily:"'Kaushan Script',cursive",fontSize:33,lineHeight:1.15,whiteSpace:"nowrap"}}>Filament <span style={{color:"#fb923c"}}>Tracker</span></div>
          <div style={{fontSize:12,color:TEXT_DIM,marginTop:3,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <span>{totalSpools} Spulen · {alleDrucker.length} Drucker</span>
            {server.modus==="ok"&&<span title="Mit dem Server verbunden" style={{width:7,height:7,borderRadius:9,background:"#4ade80",display:"inline-block"}}/>}
            {server.modus==="fehler"&&<span title={server.msg} style={{color:ROT}}>⚠ Server nicht erreichbar</span>}
          </div>
        </div>
        <button onClick={()=>setModal("add")} aria-label="Neu anlegen" style={{...bloss,width:40,height:40,borderRadius:14,background:SURFACE2,border:`1px solid ${BORDER}`,display:"flex",alignItems:"center",justifyContent:"center",color:TEXT}}>
          <Icon name="plus" size={22}/>
        </button>
      </div>

      {total===0&&<div style={{textAlign:"center",padding:"48px 8px"}}>
        <div style={{display:"flex",justifyContent:"center",gap:10,marginBottom:20}}>
          {["#f97316","#3b82f6","#22c55e"].map((c,i)=><Ring key={c} hex={c} pct={[80,45,95][i]} size={60} dicke={7}/>)}
        </div>
        <div style={{fontSize:20,fontWeight:700}}>Was liegt da eigentlich rum?</div>
        <div style={{fontSize:13,color:TEXT_DIM,marginTop:8,lineHeight:1.6}}>Scanne das Etikett deiner ersten Spule –<br/>der Rest füllt sich fast von allein.</div>
        <button onClick={()=>setModal("add")} style={{...bloss,marginTop:20,background:TEXT,color:BG,borderRadius:14,padding:"13px 22px",fontWeight:700,fontSize:15}}>Erste Spule anlegen</button>
      </div>}

      {total>0&&<>
        {suche!==null&&<div style={{display:"flex",gap:8,marginTop:14}}>
          <input autoFocus style={{...inputStyle,flex:1}} value={suche} onChange={e=>setSuche(e.target.value)} placeholder="Farbe, Marke, Material, Ort…"/>
          <button onClick={()=>setSuche(null)} style={{...bloss,color:TEXT_DIM,fontSize:13,padding:"0 4px"}}>Fertig</button>
        </div>}

        {suche===null&&nachkaufen.length>0&&filter!=="Nachkaufen"&&<button onClick={()=>setFilter("Nachkaufen")} style={{...bloss,width:"100%",marginTop:14,background:"#2a1215",border:"1px solid #4c1d24",borderRadius:16,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,textAlign:"left"}}>
          <span style={{color:ROT}}><Icon name="cart" size={20}/></span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:700,color:"#fecdd3"}}>{nachkaufen.length} {nachkaufen.length===1?"Filament":"Filamente"} nachkaufen</div>
            <div style={{fontSize:11,color:ROT,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{nachkaufen.slice(0,4).map(f=>`${f.brand} ${f.colorName}`.trim()).join(" · ")}</div>
          </div>
          <span style={{color:ROT}}><Icon name="next" size={18}/></span>
        </button>}

        {suche===null&&filter==="Alle"&&alleDrucker.length>0&&<div style={{marginTop:18}}>
          <div style={{...etikett,marginBottom:8}}>DRUCKER</div>
          {mehrfach.map(p=><DruckerKarte key={p} name={p} foto={fotos[p]} plan={belegt[p]} onSlot={slotGeklickt}
            onOhneSlot={(drucker,x)=>setPlatz({filId:x.fil.id,spoolId:x.spool.id,drucker})}/>)}
          {einzel.length>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {einzel.map(p=><DruckerKachel key={p} name={p} foto={fotos[p]} plan={belegt[p]} onSlot={slotGeklickt}/>)}
          </div>}
        </div>}

        {/* Filter: Alle · Nachkaufen · Material als Auswahlliste (passt auch bei vielen Materialien) */}
        <div style={{display:"flex",gap:6,margin:"18px 0 14px",alignItems:"center"}}>
          <button onClick={()=>setFilter("Alle")} style={chip(filter==="Alle")}>Alle</button>
          {nachkaufen.length>0&&<button onClick={()=>setFilter("Nachkaufen")} style={{...chip(filter==="Nachkaufen"),...(filter!=="Nachkaufen"&&{color:ROT})}}>Nachkaufen {nachkaufen.length}</button>}
          <div style={{flex:1}}/>
          <button onClick={()=>setRadOffen(true)} aria-label="Material wählen"
            style={{...chip(usedMats.includes(filter)),display:"flex",alignItems:"center",gap:6,maxWidth:"45%"}}>
            <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{usedMats.includes(filter)?filter:"Material"}</span>
            <span style={{fontSize:10}}>▾</span>
          </button>
        </div>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
          <div style={etikett}>{filter==="Nachkaufen"?"NACHKAUFEN":q?"TREFFER":"LAGER"} · {lager.length+nurImDrucker.length}</div>
          <button onClick={()=>setListenAnsicht(v=>!v)} aria-label={listenAnsicht?"Ringe zeigen":"Liste zeigen"} style={{...bloss,color:TEXT_DIM,padding:4}}>
            <Icon name={listenAnsicht?"grid":"list"} size={18}/>
          </button>
        </div>
        {listenAnsicht
          ?<ListView filaments={sichtbar} onEdit={f=>openDetail(f)}/>
          :<div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:"14px 6px"}}>
            {lager.map(({fil,spool})=><LagerKachel key={fil.id} fil={fil} spool={spool} onClick={()=>openDetail(fil,spool?.id)}/>)}
            {nurImDrucker.map(fil=><LagerKachel key={fil.id} fil={fil} spool={fil.inUse[0]} onClick={()=>openDetail(fil,fil.inUse[0].id)}/>)}
          </div>}
        {lager.length+nurImDrucker.length===0&&<div style={{textAlign:"center",padding:"28px 0",color:TEXT_MUTED,fontSize:13}}>Keine Treffer</div>}
        <div style={{textAlign:"center",fontSize:10,color:"#3f3f46",marginTop:28}}>Filament-Tracker {VERSION} · by MeltingHero</div>
      </>}
    </div>}

    {/* ── Spulen-Detail ── */}
    {screen==="detail"&&detailFil&&<SpulenDetail fil={detailFil} spoolId={detail.spoolId} ortVon={ortVon}
      onSpool={id=>setDetail(d=>({...d,spoolId:id}))}
      onBack={()=>zeige("home")}
      onEdit={()=>setModal(detailFil)}
      onDelete={()=>{if(confirm(`„${detailFil.brand} ${detailFil.colorName}“ mit allen Spulen löschen?`)){setFilaments(f=>f.filter(x=>x.id!==detailFil.id));zeige("home");}}}
      onAddSpool={()=>spuleHinzufuegen(detailFil)}
      onWiegen={syncFromScale}
      onRfid={id=>setRfidFor({filId:detailFil.id,spoolId:id})}
      onPlatz={s=>setPlatz({filId:detailFil.id,spoolId:s.id})}/>}

    {/* ── Regal-QR ── */}
    {screen==="qr"&&<div style={{paddingTop:"env(safe-area-inset-top)"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"14px 12px 0"}}>
        <button onClick={()=>zeige("home")} aria-label="Zurück" style={{...bloss,padding:6,color:TEXT_DIM}}><Icon name="back" size={24}/></button>
        <span style={{fontSize:17,fontWeight:700}}>QR-Code Lagerplatz scannen</span>
      </div>
      <QRScannerScreen filaments={filaments} onOpen={openDetail}/>
    </div>}

    {/* ── Untere Leiste ── */}
    <div style={{position:"fixed",left:"50%",transform:"translateX(-50%)",bottom:"calc(12px + env(safe-area-inset-bottom))",
      width:"calc(100% - 28px)",maxWidth:DESIGN_WIDTH-28,height:62,borderRadius:22,
      background:"rgba(28,28,33,0.88)",backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",border:`1px solid ${BORDER}`,
      display:"flex",alignItems:"center",justifyContent:"space-around",zIndex:20}}>
      <button onClick={()=>{setSuche(null);setFilter("Alle");zeige("home");}} aria-label="Startseite" style={dockBtn(screen==="home"&&suche===null)}><Icon name="home" size={23}/></button>
      <button onClick={()=>{setSuche("");zeige("home");}} aria-label="Suchen" style={dockBtn(screen==="home"&&suche!==null)}><Icon name="search" size={23}/></button>
      <button onClick={()=>setScanSheet(true)} aria-label="Scannen" style={{...bloss,width:56,height:56,borderRadius:19,background:TEXT,color:BG,marginTop:-30,
        display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}><Icon name="scan" size={27} stroke={2}/></button>
      <button onClick={syncFromScale} aria-label="Von Waage übernehmen" style={dockBtn(false)}><Icon name="scale" size={23}/></button>
      <button onClick={()=>setModal("settings")} aria-label="Einstellungen" style={dockBtn(false)}><Icon name="settings" size={23}/></button>
    </div>

    </div>
  </div>
    {waageSync&&<WaageSyncModal sync={waageSync} onApply={applySync} onClose={()=>setWaageSync(null)}/>}
    {dupeCheck&&<DuplicateModal
      existing={dupeCheck.existing}
      onMerge={handleMerge}
      onNew={handleForceNew}
      onClose={()=>setDupeCheck(null)}
    />}
    <BeruehrungsAnzeige/>
    {radOffen&&<SpulenRad
      eintraege={[{wert:"Alle",label:"Alle",anzahl:totalSpools},
        ...usedMats.map(m=>({wert:m,label:m,anzahl:filaments.filter(f=>f.material===m).reduce((a,f)=>a+spulenVon(f).length,0)}))]}
      wert={usedMats.includes(filter)?filter:"Alle"}
      onWahl={w=>{setFilter(w);setRadOffen(false);}}
      onClose={()=>setRadOffen(false)}/>}
    {scanSheet&&<ScanSheet onClose={()=>setScanSheet(false)}
      onNeu={()=>{setScanSheet(false);setModal("add");}}
      onQR={()=>{setScanSheet(false);zeige("qr");}}/>}
    {platzSpule&&<PlatzModal fil={platzFil} spool={platzSpule} imDrucker={(platzFil.inUse||[]).some(u=>u.id===platzSpule.id)}
      drucker={alleDrucker} fotos={fotos} belegt={belegt} startDrucker={platz.drucker} onClose={()=>setPlatz(null)}
      onMove={ziel=>{verschieben(platzFil.id,platzSpule.id,ziel);setPlatz(null);}}/>}
    {slotFuellen&&<SlotFuellenModal drucker={slotFuellen.printer} slot={slotFuellen.slot} mehrereSlots={slotFuellen.mehrere} filaments={filaments}
      onClose={()=>setSlotFuellen(null)}
      onPick={(filId,spoolId)=>{verschieben(filId,spoolId,{printer:slotFuellen.printer,slot:slotFuellen.slot});setSlotFuellen(null);}}/>}
    {rfidFil&&<RfidWriteModal fil={rfidFil} startSpoolId={rfidFor.spoolId} onClose={()=>setRfidFor(null)}/>}
    {modal==="add"&&<FilamentModal onSave={handleSave} onClose={()=>setModal(null)} printers={printers} onAddPrinter={handleAddPrinter}/>}
    {modal==="settings"&&<SettingsModal onClose={()=>setModal(null)} printers={printers} einheiten={einheiten} fotos={fotos}
      statistik={{kg:gesamtKg,spulen:totalSpools,materialien:usedMats.length}}
      onSavePrinters={p=>{setPrinters(p);savePrinters(p);}} onSaveEinheiten={setEinheiten} onSaveFotos={setFotos} onSaveOrte={orteSpeichern}
      allFilaments={filaments} onImport={(fils,prts,einh)=>{setFilaments(fils);saveFilaments(fils);setPrinters(prts);savePrinters(prts);if(einh)setEinheiten(einh);setModal(null);}}/>}
    {modal&&typeof modal==="object"&&
      <FilamentModal initial={modal} onSave={handleSave} onDelete={id=>{setFilaments(f=>f.filter(x=>x.id!==id));setModal(null);zeige("home");}} onClose={()=>setModal(null)} printers={printers} onAddPrinter={handleAddPrinter}/>}
  </>;
}

// ── Fehlerfang ──
// Ohne ihn entfernt React bei einem Fehler die ganze Oberfläche – übrig bleibt ein schwarzer Bildschirm.
// So erscheint stattdessen der Fehlertext (für die Fehlersuche) und ein Knopf zum Neuladen.
// Die Daten liegen sicher im Zwischenspeicher bzw. auf dem Server.
class Fehlerfang extends React.Component{
  constructor(p){super(p);this.state={fehler:null};}
  static getDerivedStateFromError(fehler){return {fehler};}
  componentDidCatch(fehler,info){
    window.__appLaeuft=true;
    console.error(fehler,info);
    this.details=`${VERSION} · ${new Date().toLocaleString("de-DE")}\n${fehler&&fehler.stack||fehler}\n${info&&info.componentStack||""}`;
  }
  render(){
    if(!this.state.fehler)return this.props.children;
    const f=this.state.fehler;
    const btn={...bloss,width:"100%",borderRadius:14,padding:"13px 0",fontWeight:700,fontSize:15,textAlign:"center"};
    return <div style={{...mono,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px",background:BG,color:TEXT}}>
      <div style={{background:SURFACE,borderRadius:26,padding:"26px 20px 20px",width:"100%",maxWidth:380,display:"flex",flexDirection:"column",gap:12,textAlign:"center"}}>
        <div style={{fontSize:20,fontWeight:700}}>Da ist etwas schiefgelaufen</div>
        <div style={{fontSize:14,color:TEXT_DIM,lineHeight:1.5}}>Deine Daten sind gespeichert. Mit „Neu laden“ geht es normalerweise weiter.</div>
        <div style={{fontSize:12,color:ROT,background:BG,borderRadius:12,padding:"10px 12px",textAlign:"left",wordBreak:"break-word",fontFamily:"ui-monospace,Menlo,monospace"}}>{String(f&&f.message||f)}</div>
        <button onClick={()=>location.reload()} style={{...btn,background:TEXT,color:BG}}>Neu laden</button>
        <button onClick={()=>kopieren(this.details||String(f)).catch(()=>{})} style={{...btn,background:SURFACE2,color:TEXT_DIM,fontWeight:400,fontSize:14}}>Fehlertext kopieren</button>
        <div style={{fontSize:11,color:TEXT_MUTED}}>{VERSION}</div>
      </div>
    </div>;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<Fehlerfang><App/></Fehlerfang>);
