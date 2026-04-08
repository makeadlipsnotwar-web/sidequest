"use client";

import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

export default function Home() {
  // --- STATES ---
  const [user, setUser] = useState<any>(null);
  const [ladeDaten, setLadeDaten] = useState(true);
  const [spielerDaten, setSpielerDaten] = useState<any>(null);
  const [meineGruppe, setMeineGruppe] = useState<any>(null);
  const [crewMitglieder, setCrewMitglieder] = useState<any[]>([]);
  const [wochenQuests, setWochenQuests] = useState<any[]>([]);
  
  // UI & Auth States
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [isLoginModus, setIsLoginModus] = useState(true);
  const [activeModal, setActiveModal] = useState<null | 'profile' | 'crew'>(null);
  const [ladeStripe, setLadeStripe] = useState(false);

  // Edit/Input States
  const [tempName, setTempName] = useState("");
  const [tempPic, setTempPic] = useState("");
  const [tempGroupName, setTempGroupName] = useState("");
  const [tempGroupPic, setTempGroupPic] = useState("");
  const [gruppenNameInput, setGruppenNameInput] = useState("");
  const [einladungsCodeInput, setEinladungsCodeInput] = useState("");

  // Game States
  const [rerolls, setRerolls] = useState(0);
  const [uploadingQuestId, setUploadingQuestId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- INITIALISIERUNG ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) ladeSpielerProfil(session.user.id);
      else setLadeDaten(false);
    });
  }, []);

  // --- DATEN LADEN ---
  async function ladeSpielerProfil(userId: string) {
    const { data } = await supabase.from('spieler').select('*').eq('id', userId).single();
    if (data) {
      let aktuelleRerolls = data.rerolls;
      
      // Stripe Success Check (Nach Rückkehr von der Kasse)
      if (typeof window !== "undefined") {
        const query = new URLSearchParams(window.location.search);
        if (query.get("success") === "true") {
          aktuelleRerolls += 2;
          await supabase.from('spieler').update({ rerolls: aktuelleRerolls }).eq('id', userId);
          window.history.replaceState(null, '', window.location.pathname);
          alert("ZAHLUNG ERFOLGREICH. +2 Rerolls gutgeschrieben.");
        }
      }

      setSpielerDaten(data);
      setTempName(data.benutzername);
      setTempPic(data.profil_bild_url);
      setRerolls(aktuelleRerolls);
      ladeMeineGruppe(userId);
      ladeWochenQuests(userId);
    } else { setLadeDaten(false); }
  }

  async function ladeMeineGruppe(userId: string) {
    const { data: mitglied } = await supabase.from('gruppen_mitglieder').select('gruppen_id').eq('spieler_id', userId).single();
    if (mitglied) {
      const { data: gruppe } = await supabase.from('gruppen').select('*').eq('id', mitglied.gruppen_id).single();
      setMeineGruppe(gruppe);
      setTempGroupName(gruppe.name);
      setTempGroupPic(gruppe.gruppen_bild_url);
      ladeCrewMitglieder(mitglied.gruppen_id);
    }
    setLadeDaten(false);
  }

  async function ladeCrewMitglieder(gruppenId: string) {
    const { data } = await supabase.from('gruppen_mitglieder').select('spieler:spieler_id(benutzername, score, profil_bild_url)').eq('gruppen_id', gruppenId);
    if (data) {
      const sorted = data.map((m: any) => m.spieler).sort((a: any, b: any) => b.score - a.score);
      setCrewMitglieder(sorted);
    }
  }

  async function ladeWochenQuests(userId: string) {
    const { data } = await supabase.from('wochen_quests').select('*').eq('spieler_id', userId).order('erstellt_am', { ascending: true });
    if (data) setWochenQuests(data);
  }

  // --- CORE GAME LOGIK (XP, SCORE, PENALTY) ---
  async function questsGenerieren() {
    if (!spielerDaten || !meineGruppe || !user) return;

    // 1. STRAF-LOGIK: XP-Abzug für nicht erledigte Quests der Vorwoche
    const offeneQuests = wochenQuests.filter(q => !q.erledigt);
    let aktuellesLevel = spielerDaten.level;
    let aktuelleXp = spielerDaten.xp;

    if (offeneQuests.length > 0) {
      let xpStrafe = 0;
      offeneQuests.forEach(q => { xpStrafe += q.difficulty * 50; });
      aktuelleXp = Math.max(0, aktuelleXp - xpStrafe);
      
      // Neues Level nach Strafe berechnen (Level-Down möglich)
      aktuellesLevel = Math.floor(aktuelleXp / 1000) + 1;
      if (aktuellesLevel > 10) aktuellesLevel = 10;

      await supabase.from('spieler').update({ xp: aktuelleXp, level: aktuellesLevel }).eq('id', user.id);
      alert(`BESTRAFUNG: ${offeneQuests.length} Quests ignoriert. -${xpStrafe} XP abgezogen.`);
    }

    // 2. ALTE QUESTS LÖSCHEN
    await supabase.from('wochen_quests').delete().eq('spieler_id', user.id);

    // 3. NEUE QUESTS AUS DB POOL ZIEHEN
    const maxPoolLvl = aktuellesLevel + 1;
    const { data: pool } = await supabase.from('quest_pool').select('*').lte('difficulty', maxPoolLvl);
    if (!pool || pool.length === 0) return alert("Quest-Pool ist leer!");

    const auswahl = pool.sort(() => 0.5 - Math.random()).slice(0, 10);
    const neueQuests = auswahl.map(q => ({
      spieler_id: user.id,
      quest_text: q.text,
      difficulty: q.difficulty,
      kategorie: q.kategorie,
      erledigt: false
    }));

    const { data } = await supabase.from('wochen_quests').insert(neueQuests).select();
    if (data) setWochenQuests(data);
    ladeSpielerProfil(user.id);
  }

  async function handleFileUpload(e: any) {
    const file = e.target.files[0];
    if (!file || !uploadingQuestId || !user || !spielerDaten) return;
    setUploadingQuestId(uploadingQuestId);
    
    const path = `${user.id}/${uploadingQuestId}-${Date.now()}.${file.name.split('.').pop()}`;
    const { error } = await supabase.storage.from('beweise').upload(path, file);
    if (error) { alert(error.message); setUploadingQuestId(null); return; }

    const { data: { publicUrl } } = supabase.storage.from('beweise').getPublicUrl(path);
    const quest = wochenQuests.find(q => q.id === uploadingQuestId);
    
    // XP & Score Kalkulation
    const punkte = (quest?.difficulty || 1) * 50;
    const xpGewinn = (quest?.difficulty || 1) * 100;
    
    const neueXp = (spielerDaten.xp || 0) + xpGewinn;
    const neuerScore = (spielerDaten.score || 0) + punkte;
    let neuesLevel = Math.floor(neueXp / 1000) + 1;
    if (neuesLevel > 10) neuesLevel = 10;

    await supabase.from('wochen_quests').update({ erledigt: true, beweis_url: publicUrl }).eq('id', uploadingQuestId);
    await supabase.from('spieler').update({ score: neuerScore, xp: neueXp, level: neuesLevel }).eq('id', user.id);
    
    setSpielerDaten({...spielerDaten, score: neuerScore, xp: neueXp, level: neuesLevel});
    setUploadingQuestId(null);
    ladeWochenQuests(user.id);
    if (meineGruppe) ladeCrewMitglieder(meineGruppe.id);
    alert(`QUEST VERIFIZIERT. +${punkte} Punkte & +${xpGewinn} XP.`);
  }

  async function questRerollen(index: number) {
    if (rerolls <= 0) return alert("Keine Rerolls übrig.");
    const quest = wochenQuests[index];
    const { data: pool } = await supabase.from('quest_pool').select('*').lte('difficulty', spielerDaten.level + 1);
    if (!pool) return;

    const neue = pool[Math.floor(Math.random() * pool.length)];
    const { data } = await supabase.from('wochen_quests').update({ 
      quest_text: neue.text, 
      difficulty: neue.difficulty,
      kategorie: neue.kategorie 
    }).eq('id', quest.id).select().single();

    if (data) {
      const copy = [...wochenQuests]; copy[index] = data; setWochenQuests(copy);
      const nR = rerolls - 1; 
      await supabase.from('spieler').update({ rerolls: nR }).eq('id', user.id); 
      setRerolls(nR);
    }
  }

  // --- STRIPE & IDENTITY ---
  async function kaufeRerolls() {
    setLadeStripe(true);
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: user.id, priceId: 'price_1TBLiiDOjCH16hSIkGDEMR5F' }),
    });
    const d = await res.json();
    if (d.url) window.location.href = d.url;
    else setLadeStripe(false);
  }

  async function updateProfil() {
    await supabase.from('spieler').update({ benutzername: tempName, profil_bild_url: tempPic }).eq('id', user.id);
    setActiveModal(null); ladeSpielerProfil(user.id);
  }

  async function updateGruppe() {
    await supabase.from('gruppen').update({ name: tempGroupName, gruppen_bild_url: tempGroupPic }).eq('id', meineGruppe.id);
    setActiveModal(null); ladeMeineGruppe(user.id);
  }

  async function handleAuth(e: any) {
    e.preventDefault();
    if (isLoginModus) await supabase.auth.signInWithPassword({ email, password: passwort });
    else {
      const { data } = await supabase.auth.signUp({ email, password: passwort });
      if (data.user) await supabase.from('spieler').insert([{ id: data.user.id, benutzername: email.split('@')[0], xp: 0, level: 1, score: 0 }]);
    }
    window.location.reload();
  }

  async function gruppeErstellen() {
    const code = "SQUAD-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const { data } = await supabase.from('gruppen').insert([{ name: gruppenNameInput, einladungs_code: code }]).select().single();
    if (data) {
      await supabase.from('gruppen_mitglieder').insert([{ spieler_id: user.id, gruppen_id: data.id }]);
      window.location.reload();
    }
  }

  async function gruppeBeitreten() {
    const { data } = await supabase.from('gruppen').select('*').eq('einladungs_code', einladungsCodeInput).single();
    if (data) {
      await supabase.from('gruppen_mitglieder').insert([{ spieler_id: user.id, gruppen_id: data.id }]);
      window.location.reload();
    }
  }

  // --- UI RENDER ---
  if (ladeDaten) return <div className="min-h-screen bg-black flex items-center justify-center text-zinc-800 text-[10px] tracking-[0.5em]">SYSTEM_RELOADING</div>;

  if (!user) {
    return (
      <main className="min-h-screen bg-black flex flex-col items-center justify-center p-8 text-white">
        <h1 className="text-3xl font-light tracking-[0.4em] uppercase mb-16">Sidequest</h1>
        <form onSubmit={handleAuth} className="w-full max-w-sm flex flex-col gap-8 bg-zinc-900/10 p-10 border border-zinc-900">
          <input type="email" placeholder="IDENTITY" value={email} onChange={e => setEmail(e.target.value)} className="bg-transparent border-b border-zinc-900 p-2 text-[10px] outline-none focus:border-zinc-500 uppercase tracking-widest" />
          <input type="password" placeholder="PASSWORD" value={passwort} onChange={e => setPasswort(e.target.value)} className="bg-transparent border-b border-zinc-900 p-2 text-[10px] outline-none focus:border-zinc-500 uppercase tracking-widest" />
          <button type="submit" className="bg-white text-black py-4 text-[10px] font-bold uppercase tracking-widest">{isLoginModus ? "Enter" : "Register"}</button>
          <p onClick={() => setIsLoginModus(!isLoginModus)} className="text-center text-[9px] text-zinc-600 uppercase tracking-widest cursor-pointer">{isLoginModus ? "Create Access" : "Back to Login"}</p>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-zinc-500 font-sans p-6 md:p-16">
      <input type="file" accept="video/*,image/*" capture="environment" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />

      {/* HEADER */}
      <header className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center mb-32 border-b border-zinc-950 pb-16">
        <div className="flex items-center gap-10 group flex-1">
          <div className="relative">
            <img src={meineGruppe?.gruppen_bild_url || 'https://api.dicebear.com/7.x/identicon/svg?seed=Crew'} className="w-24 h-24 border border-zinc-800 grayscale object-cover" />
            <button onClick={() => setActiveModal('crew')} className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-[8px] font-bold uppercase">Edit Crew</button>
          </div>
          <div>
            <h1 className="text-4xl font-light tracking-[0.2em] uppercase text-white leading-tight">{meineGruppe?.name || "Independent"}</h1>
            <p className="text-[10px] uppercase tracking-[0.5em] text-zinc-800 mt-2">Code // {meineGruppe?.einladungs_code || "N/A"}</p>
          </div>
        </div>

        <div className="flex items-center gap-8 pl-12 border-l border-zinc-900 text-right">
          <div>
            <h2 className="text-lg font-light tracking-widest text-zinc-200 uppercase leading-none mb-1">{spielerDaten?.benutzername}</h2>
            <p className="text-[10px] uppercase text-white tracking-widest">{spielerDaten?.score} Points</p>
            <div className="flex justify-end gap-4 mt-3">
              <button onClick={kaufeRerolls} className="text-[9px] text-yellow-700 uppercase tracking-widest">{ladeStripe ? '...' : `${rerolls} Rerolls (+)`}</button>
              <button onClick={() => setActiveModal('profile')} className="text-[9px] text-zinc-700 uppercase tracking-widest hover:text-white">Settings</button>
              <button onClick={() => { supabase.auth.signOut(); window.location.reload(); }} className="text-[9px] text-red-950 uppercase tracking-widest">Exit</button>
            </div>
          </div>
          <img src={spielerDaten?.profil_bild_url} className="w-14 h-14 rounded-full border border-zinc-900 grayscale opacity-60" />
        </div>
      </header>

      {/* MODALS */}
      {activeModal && (
        <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-6 backdrop-blur-md">
          <div className="bg-zinc-900 border border-zinc-800 p-10 w-full max-w-md flex flex-col gap-8 shadow-2xl">
            <h2 className="text-xs uppercase tracking-[0.5em] text-white border-b border-zinc-800 pb-4">{activeModal === 'profile' ? 'User Identity' : 'Crew Identity'}</h2>
            <input type="text" value={activeModal === 'profile' ? tempName : tempGroupName} onChange={e => activeModal === 'profile' ? setTempName(e.target.value) : setTempGroupName(e.target.value)} className="bg-transparent border-b border-zinc-800 p-2 text-white text-xs outline-none focus:border-white transition" placeholder="Name" />
            <input type="text" value={activeModal === 'profile' ? tempPic : tempGroupPic} onChange={e => activeModal === 'profile' ? setTempPic(e.target.value) : setTempGroupPic(e.target.value)} className="bg-transparent border-b border-zinc-800 p-2 text-white text-xs outline-none focus:border-white transition" placeholder="Image URL" />
            <button onClick={activeModal === 'profile' ? updateProfil : updateGruppe} className="bg-white text-black py-4 text-[10px] font-bold uppercase tracking-widest">Confirm Changes</button>
            <button onClick={() => setActiveModal(null)} className="text-[9px] text-zinc-700 uppercase text-center tracking-widest">Abort</button>
          </div>
        </div>
      )}

      {/* GRID */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-4 gap-24">
        
        {/* LEADERBOARD */}
        <div className="lg:col-span-1 border-t border-zinc-950 pt-12">
          <h2 className="text-[10px] uppercase tracking-[0.5em] text-zinc-800 mb-12 font-bold italic">Crew Ranking</h2>
          <div className="flex flex-col gap-10">
            {crewMitglieder.map((m, i) => (
              <div key={i} className="flex items-center gap-6 group">
                <span className="text-[9px] font-mono text-zinc-900">{(i+1).toString().padStart(2,'0')}</span>
                <img src={m.profil_bild_url} className="w-10 h-10 rounded-full border border-zinc-950 grayscale opacity-40 group-hover:opacity-100 transition duration-700" />
                <div className="flex-1 flex justify-between">
                  <span className="text-xs text-zinc-400 uppercase tracking-wider">{m.benutzername}</span>
                  <span className="text-[10px] text-zinc-800 font-mono">{m.score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* QUESTS */}
        <div className="lg:col-span-3 border-t border-zinc-950 pt-12">
          {!meineGruppe ? (
             <div className="max-w-sm">
                <h2 className="text-xs uppercase tracking-[0.4em] text-white mb-8 italic">No Crew Connection</h2>
                <div className="flex flex-col gap-4">
                  <input type="text" placeholder="Establish New Crew Name" value={gruppenNameInput} onChange={e => setGruppenNameInput(e.target.value)} className="bg-transparent border border-zinc-900 p-3 text-xs outline-none focus:border-zinc-500 transition uppercase" />
                  <button onClick={gruppeErstellen} className="bg-zinc-100 text-black py-3 text-[10px] font-bold uppercase tracking-widest">Initialize</button>
                  <p className="text-center text-[9px] uppercase tracking-widest py-2 text-zinc-800">or connect by code</p>
                  <input type="text" placeholder="SQUAD-..." value={einladungsCodeInput} onChange={e => setEinladungsCodeInput(e.target.value)} className="bg-transparent border border-zinc-900 p-3 text-xs outline-none focus:border-zinc-500 font-mono text-white" />
                  <button onClick={gruppeBeitreten} className="border border-zinc-800 py-3 text-[10px] uppercase text-white hover:bg-zinc-900 transition tracking-widest">Connect</button>
                </div>
             </div>
          ) : (
            <>
              <div className="flex justify-between items-baseline mb-20">
                <h2 className="text-[10px] uppercase tracking-[0.6em] text-zinc-800 font-bold italic">Active Cycle</h2>
                <div className="text-[10px] uppercase tracking-[0.3em] font-mono text-zinc-900">{wochenQuests.filter(q => q.erledigt).length} / 10 Verified</div>
              </div>

              {wochenQuests.length === 0 ? (
                <div className="text-center py-20 border border-dashed border-zinc-900">
                  <button onClick={questsGenerieren} className="border border-zinc-600 px-10 py-5 text-[10px] uppercase tracking-[0.5em] hover:bg-white hover:text-black transition duration-500">Initiate Quests</button>
                </div>
              ) : (
                <div className="flex flex-col gap-24">
                  {wochenQuests.map((q, i) => (
                    <div key={q.id} className={`group flex items-start gap-16 border-b border-zinc-950 pb-20 last:border-0 ${q.erledigt ? 'opacity-20' : ''}`}>
                      <span className="text-zinc-900 text-[10px] font-mono mt-2">REF_{(i+1).toString().padStart(2,'0')}</span>
                      <div className="flex-1">
                        <span className="text-[8px] uppercase tracking-[0.3em] text-zinc-700 block mb-3">{q.kategorie || 'Identity'}</span>
                        <p className={`text-2xl md:text-4xl font-light leading-[1.1] tracking-tight ${q.erledigt ? 'line-through text-zinc-800 italic' : 'text-zinc-200'}`}>{q.quest_text}</p>
                        {q.erledigt && q.beweis_url && <a href={q.beweis_url} target="_blank" className="text-[8px] uppercase tracking-widest text-zinc-600 mt-4 block hover:text-white transition">Show_Proof_0{i+1} ↗</a>}
                      </div>
                      {!q.erledigt && (
                        <div className="flex flex-col items-end gap-6">
                          <button onClick={() => {setUploadingQuestId(q.id); fileInputRef.current?.click();}} className="bg-white text-black px-10 py-4 text-[10px] font-black uppercase tracking-widest hover:invert transition duration-500">Verify</button>
                          <button onClick={() => questRerollen(i)} className="text-[9px] uppercase text-zinc-800 hover:text-zinc-300 transition tracking-tighter">Swap</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}