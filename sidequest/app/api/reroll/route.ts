import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabaseClient() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.');
  }
  return createClient(supabaseUrl, supabaseServiceKey);
}

async function handleRerollRequest() {
  try {
    const supabase = getSupabaseClient();
    // Hole alle Spieler
    const { data: alleSpieler, error: spielerError } = await supabase
      .from('spieler')
      .select('id, level, xp');

    if (spielerError || !alleSpieler) {
      return NextResponse.json({ error: 'Fehler beim Laden der Spieler' }, { status: 500 });
    }

    for (const spieler of alleSpieler) {
      await rerollQuestsForPlayer(spieler.id, spieler.level, spieler.xp);
    }

    return NextResponse.json({ success: true, message: 'Wöchentliches Rerolling abgeschlossen' });
  } catch (error) {
    console.error('Reroll error:', error);
    return NextResponse.json({ error: 'Interner Serverfehler' }, { status: 500 });
  }
}

export async function GET() {
  return handleRerollRequest();
}

export async function POST() {
  return handleRerollRequest();
}

async function rerollQuestsForPlayer(spielerId: string, aktuellesLevel: number, aktuelleXp: number) {
  const supabase = getSupabaseClient();
  // 1. Offene Quests holen und Strafe berechnen
  const { data: offeneQuests } = await supabase
    .from('wochen_quests')
    .select('*')
    .eq('spieler_id', spielerId)
    .eq('erledigt', false);

  if (offeneQuests && offeneQuests.length > 0) {
    let xpStrafe = 0;
    offeneQuests.forEach(q => { xpStrafe += q.difficulty * 50; });
    aktuelleXp = Math.max(0, aktuelleXp - xpStrafe);

    // Neues Level berechnen
    let neuesLevel = Math.floor(aktuelleXp / 1000) + 1;
    if (neuesLevel > 10) neuesLevel = 10;

    await supabase.from('spieler').update({ xp: aktuelleXp, level: neuesLevel }).eq('id', spielerId);
  }

  // 2. Alte Quests löschen
  await supabase.from('wochen_quests').delete().eq('spieler_id', spielerId);

  // 3. Neue Quests generieren
  const maxPoolLvl = aktuellesLevel + 1;
  const { data: pool } = await supabase
    .from('quest_pool')
    .select('*')
    .lte('difficulty', maxPoolLvl);

  if (!pool || pool.length === 0) return;

  const auswahl = pool.sort(() => 0.5 - Math.random()).slice(0, 10);
  const neueQuests = auswahl.map(q => ({
    spieler_id: spielerId,
    quest_text: q.text,
    difficulty: q.difficulty,
    kategorie: q.kategorie,
    erledigt: false
  }));

  await supabase.from('wochen_quests').insert(neueQuests);
}