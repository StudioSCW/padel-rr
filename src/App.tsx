// @ts-nocheck
import React, { useMemo, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, Shuffle, Download, Upload, Trophy, Users, Settings, PlayCircle } from "lucide-react";

/**
 * Padel Round Robin – Single-file React app (Velno Edition)
 * Plain JavaScript (sin TypeScript) para evitar errores de build.
 * - Individual (parejas rotativas) y Equipos fijos (round-robin clásico)
 * - Rondas, canchas, marcadores, tabla general (3/1/0)
 * - Exportar/Importar JSON + Persistencia local
 * - Log a Google Sheets vía Apps Script Web App
 */

// ---------- Helpers ----------
const MODES = { INDIVIDUAL: "INDIVIDUAL", TEAMS: "TEAMS" };
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Round-robin clásico para equipos fijos (método del círculo)
function generateTeamRoundRobin(teams, roundsLimit) {
  const n = teams.length;
  if (n < 2) return [];
  const isOdd = n % 2 === 1;
  const list = isOdd ? [...teams, { id: "BYE", name: "BYE", players: [] }] : [...teams];
  const m = list.length;
  const half = m / 2;
  let left = list.slice(0, half);
  let right = list.slice(half).reverse();
  const rounds = [];

  const totalRounds = roundsLimit ? clamp(roundsLimit, 1, m - 1) : m - 1;
  for (let r = 0; r < totalRounds; r++) {
    const pairings = [];
    for (let i = 0; i < half; i++) {
      const a = left[i];
      const b = right[i];
      if (a.id !== "BYE" && b.id !== "BYE") pairings.push([a, b]);
    }
    rounds.push(pairings);

    // rotación (excepto el primero de la izquierda)
    const fixed = left[0];
    const moved = right.shift();
    right.push(left.pop());
    left = [fixed, moved, ...left.slice(1)];
  }
  return rounds; // [ [ [teamA, teamB], ... ], ... ]
}

// Emparejamiento individual con rotación de descansos
function generateIndividualSchedule(players, rounds, courts, history = {}) {
  const teammateCounts = history.teammateCounts || {};
  const matchupCounts = history.matchupCounts || {};
  const restCounts = { ...(history.restCounts || {}) };

  const roundsOut = [];

  // capacidad por ronda (jugadores en pista) = 4 por cancha
  const maxCourtsUsable = Math.min(courts, Math.floor(players.length / 4));
  const capacityPerRound = 4 * maxCourtsUsable;

  if (capacityPerRound < 4) {
    // no hay jugadores suficientes para formar al menos una pista
    return { rounds: [], history: { teammateCounts, matchupCounts, restCounts } };
  }

  for (let r = 0; r < rounds; r++) {
    // 1) Ordenar por quién ha descansado más (descansa menos → prioridad baja)
    //    Tiebreak aleatorio para no sesgar siempre igual
    const plWithRest = players.map(p => ({
      p,
      rest: restCounts[p.id] || 0,
      rnd: Math.random()
    }));

    // Quienes más descansaron entran primero
    plWithRest.sort((a, b) => (b.rest - a.rest) || (a.rnd - b.rnd));

    // 2) Tomar a los K que jugarán esta ronda
    const chosen = plWithRest.slice(0, capacityPerRound).map(x => x.p);
    const resting = plWithRest.slice(capacityPerRound).map(x => x.p);

    // 3) Incrementar descanso de los que no juegan esta ronda
    for (const rp of resting) {
      restCounts[rp.id] = (restCounts[rp.id] || 0) + 1;
    }

    // 4) Emparejar a los elegidos (misma lógica “smart” de antes)
    const available = shuffleArray(chosen);
    const matches = [];

    while (available.length >= 4 && matches.length < maxCourtsUsable) {
      let bestQuad = null;
      let bestScore = Infinity;

      for (let i = 0; i < available.length; i++) {
        for (let j = i + 1; j < available.length; j++) {
          for (let k = j + 1; k < available.length; k++) {
            for (let l = k + 1; l < available.length; l++) {
              const cand = [available[i], available[j], available[k], available[l]];
              const pairings = [
                [[cand[0], cand[1]], [cand[2], cand[3]]],
                [[cand[0], cand[2]], [cand[1], cand[3]]],
                [[cand[0], cand[3]], [cand[1], cand[2]]],
              ];
              for (const p of pairings) {
                const score = pairingPenalty(p, teammateCounts, matchupCounts);
                if (score < bestScore) { bestScore = score; bestQuad = { cand, p }; }
              }
            }
          }
        }
      }

      if (!bestQuad) break;

      for (const pl of bestQuad.cand) {
        const idx = available.indexOf(pl);
        if (idx >= 0) available.splice(idx, 1);
      }

      const match = {
        teamA: bestQuad.p[0].map(p => p),
        teamB: bestQuad.p[1].map(p => p),
        scoreA: 0,
        scoreB: 0,
        id: uid(),
      };

      const [a1, a2] = match.teamA; const [b1, b2] = match.teamB;
      incPair(teammateCounts, a1.id, a2.id);
      incPair(teammateCounts, b1.id, b2.id);
      for (const x of [a1, a2]) for (const y of [b1, b2]) incPair(matchupCounts, x.id, y.id);

      matches.push(match);
    }

    roundsOut.push(matches);
  }

  return { rounds: roundsOut, history: { teammateCounts, matchupCounts, restCounts } };
}

function pairingPenalty(pairings, teammateCounts, matchupCounts) {
  let score = 0;
  const wTeam = 10; // penaliza repetir compañero
  const wOpp = 2;   // penaliza menos repetir rival
  const seenPairs = new Set();
  const pairKey = (a, b) => [a.id, b.id].sort().join("|");

  for (const team of pairings) {
    const [p1, p2] = team;
    const k = pairKey(p1, p2);
    if (!seenPairs.has(k)) {
      const tcount = (teammateCounts[p1.id]?.[p2.id] || 0);
      score += wTeam * tcount;
      seenPairs.add(k);
    }
  }
  const [tA, tB] = pairings;
  for (const a of tA) for (const b of tB) {
    const c = (matchupCounts[a.id]?.[b.id] || 0);
    score += wOpp * c;
  }
  return score;
}

function incPair(matrix, a, b) {
  if (!matrix[a]) matrix[a] = {}; if (!matrix[b]) matrix[b] = {};
  matrix[a][b] = (matrix[a][b] || 0) + 1;
  matrix[b][a] = (matrix[b][a] || 0) + 1;
}

// ---------- Storage ----------
const STORE_KEY = "padel-rr-v1";
const loadStore = () => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null") || null; } catch { return null; }
};
const saveStore = (data) => { localStorage.setItem(STORE_KEY, JSON.stringify(data)); };

// ---------- App ----------
export default function App() {
  // URL por defecto (puedes cambiarla en la UI)
  const DEFAULT_SHEETS_URL = "https://script.google.com/macros/s/AKfycbz3yva2YtkJ74UrcFikn42l6F4pWDSTA31V80qmyYZC7Ww6M-V4Eb9eNUDO2Ho6NhUarw/exec";

  const [sheetsUrl, setSheetsUrl] = useState(DEFAULT_SHEETS_URL);
  const [tournamentId, setTournamentId] = useState(() => uid());

  const [mode, setMode] = useState(MODES.INDIVIDUAL);
  const [players, setPlayers] = useState([]); // {id,name}
  const [teams, setTeams] = useState([]);     // {id,name,players:[p1,p2]}
  const [nameInput, setNameInput] = useState("");
  const [rounds, setRounds] = useState(5);
  const [courts, setCourts] = useState(2);
  // Control de inputs móviles
  const [roundsStr, setRoundsStr] = useState(String(rounds));
  const [courtsStr, setCourtsStr] = useState(String(courts));

  useEffect(() => { setRoundsStr(String(rounds)); }, [rounds]);
  useEffect(() => { setCourtsStr(String(courts)); }, [courts]);

  function commitRounds() {
    const n = parseInt(roundsStr.replace(/\D/g, ''), 10);
    const value = clamp(Number.isFinite(n) ? n : 1, 1, 20);
    setRounds(value);
    setRoundsStr(String(value));
  }

  function commitCourts() {
    const n = parseInt(courtsStr.replace(/\D/g, ''), 10);
    const value = clamp(Number.isFinite(n) ? n : 1, 1, 12);
    setCourts(value);
    setCourtsStr(String(value));
  }

  const [schedule, setSchedule] = useState([]); // rounds -> matches
  const [history, setHistory] = useState({ teammateCounts: {}, matchupCounts: {}, restCounts: {} });
  const [standings, setStandings] = useState([]);

  // Load persisted
  useEffect(() => {
    const s = loadStore();
    if (s) {
      setMode(s.mode || MODES.INDIVIDUAL);
      setPlayers(s.players || []);
      setTeams(s.teams || []);
      setRounds(s.rounds || 5);
      setCourts(s.courts || 2);
      setSchedule(s.schedule || []);
      setHistory(s.history || { teammateCounts: {}, matchupCounts: {}, restCounts: {} });
      setSheetsUrl(s.sheetsUrl || DEFAULT_SHEETS_URL);
      setTournamentId(s.tournamentId || uid());
    }
  }, []);

  // Persist
  useEffect(() => {
    saveStore({ mode, players, teams, rounds, courts, schedule, history, sheetsUrl, tournamentId });
  }, [mode, players, teams, rounds, courts, schedule, history, sheetsUrl, tournamentId]);

  // Recalculate standings when schedule changes
  useEffect(() => {
    setStandings(computeStandings(mode, schedule, players, teams));
  }, [schedule, mode, players, teams]);

  const canGenerate = useMemo(() => {
    if (mode === MODES.INDIVIDUAL) return players.length >= 4 && courts >= 1 && rounds >= 1;
    if (mode === MODES.TEAMS) return teams.length >= 2 && courts >= 1 && rounds >= 1;
    return false;
  }, [mode, players, teams, courts, rounds]);

  function addPlayer() {
    const n = nameInput.trim();
    if (!n) return;
    if (players.some(p => p.name.toLowerCase() === n.toLowerCase())) return;
    setPlayers([...players, { id: uid(), name: n }]);
    setNameInput("");
  }

  function removePlayer(id) {
    setPlayers(players.filter(p => p.id !== id));
  }

  function createTeamsAuto() {
    const even = players.length - (players.length % 2);
    const ps = shuffleArray(players.slice(0, even));
    const t = [];
    for (let i = 0; i < ps.length; i += 2) {
      const a = ps[i], b = ps[i + 1];
      t.push({ id: uid(), name: `${a.name} & ${b.name}`.slice(0, 40), players: [a, b] });
    }
    setTeams(t);
  }

  function clearAll() {
    setPlayers([]); setTeams([]); setSchedule([]);
    setHistory({ teammateCounts: {}, matchupCounts: {}, restCounts: {} });
  }

  function generateSchedule() {
    if (mode === MODES.TEAMS) {
      const rr = generateTeamRoundRobin(teams, rounds);
      const sched = rr.map((pairings) => pairings.slice(0, courts).map(([A, B]) => ({
        id: uid(),
        teamA: A.players,
        teamB: B.players,
        teamNameA: A.name,
        teamNameB: B.name,
        scoreA: 0,
        scoreB: 0,
      })));
      setSchedule(sched);
      logToSheets("generate_schedule", { mode, tournamentId, rounds, courts, teamsCount: teams.length, pairings: sched.map(r => r.map((m) => ({ teamA: (m.teamNameA || m.teamA.map((p) => p.name).join(" + ")), teamB: (m.teamNameB || m.teamB.map((p) => p.name).join(" + ")) }))) });
      return;
    }
    const { rounds: rr, history: h } = generateIndividualSchedule(players, rounds, courts, history);
    setSchedule(rr);
    setHistory(h);
    logToSheets("generate_schedule", { mode, tournamentId, rounds, courts, playersCount: players.length, pairings: rr.map(r => r.map((m) => ({ teamA: m.teamA.map((p) => p.name).join(" + "), teamB: m.teamB.map((p) => p.name).join(" + ") }))) });
  }

  function updateScore(rIdx, mIdx, field, val) {
    const v = clamp(parseInt(val || 0, 10), 0, 99);
    setSchedule(prev => prev.map((r, i) => i !== rIdx ? r : r.map((m, j) => j !== mIdx ? m : { ...m, [field]: v })));
    try {
      const m = schedule[rIdx]?.[mIdx];
      if (m) {
        const payload = {
          mode,
          tournamentId,
          round: rIdx + 1,
          matchId: m.id,
          teamA: (m.teamNameA || m.teamA.map((p) => p.name).join(" + ")),
          teamB: (m.teamNameB || m.teamB.map((p) => p.name).join(" + ")),
          scoreA: field === 'scoreA' ? v : m.scoreA,
          scoreB: field === 'scoreB' ? v : m.scoreB,
        };
        logToSheets("update_score", payload);
      }
    } catch { }
  }

  function randomizeNextRound() {
    if (mode === MODES.INDIVIDUAL) {
      const { rounds: rr, history: h } = generateIndividualSchedule(players, 1, courts, history);
      setSchedule(prev => [...prev, rr[0]]);
      setHistory(h);
      logToSheets("new_round", { mode, tournamentId, round: schedule.length + 1, pairings: rr[0].map((m) => ({ teamA: m.teamA.map((p) => p.name).join(" + "), teamB: m.teamB.map((p) => p.name).join(" + ") })) });
    } else {
      const rr = generateTeamRoundRobin(teams, 1);
      const sched = rr.map((pairings) => pairings.slice(0, courts).map(([A, B]) => ({
        id: uid(), teamA: A.players, teamB: B.players, teamNameA: A.name, teamNameB: B.name, scoreA: 0, scoreB: 0,
      })));
      setSchedule(prev => [...prev, ...sched]);
      logToSheets("new_round", { mode, tournamentId, round: schedule.length + 1, pairings: sched[0]?.map((m) => ({ teamA: (m.teamNameA || m.teamA.map((p) => p.name).join(" + ")), teamB: (m.teamNameB || m.teamB.map((p) => p.name).join(" + ")) })) });
    }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify({ mode, players, teams, rounds, courts, schedule, history, sheetsUrl, tournamentId }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `padel_rr_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    logToSheets("export", { mode, tournamentId, playersCount: players.length, teamsCount: teams.length, rounds: schedule.length });
  }

  function importJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        setMode(data.mode || MODES.INDIVIDUAL);
        setPlayers(data.players || []);
        setTeams(data.teams || []);
        setRounds(data.rounds || 5);
        setCourts(data.courts || 2);
        setSchedule(data.schedule || []);
        setHistory(data.history || { teammateCounts: {}, matchupCounts: {} });
        if (data.sheetsUrl) setSheetsUrl(data.sheetsUrl);
        if (data.tournamentId) setTournamentId(data.tournamentId);
      } catch (err) { alert("Archivo inválido"); }
    };
    reader.readAsText(file);
  }

  function exportStandingsCSV() {
    if (!standings || standings.length === 0) {
      alert("No hay resultados para exportar todavía.");
      return;
    }

    // columnas estándar (Excel friendly)
    const headers = ["Pos", "Nombre", "PJ", "PG", "PE", "PP", "GF", "GC", "DG", "Pts"];

    // intenta leer campos típicos; si no existen, usa 0
    const rows = standings.map((r, i) => [
      i + 1,
      r.name ?? r.teamName ?? "—",
      r.pj ?? 0,
      r.pg ?? r.win ?? 0,
      r.pe ?? r.draw ?? 0,
      r.pp ?? r.loss ?? 0,
      r.gf ?? 0,
      r.gc ?? 0,
      (r.dg ?? ((r.gf ?? 0) - (r.gc ?? 0))),
      r.pts ?? r.points ?? 0,
    ]);

    // construir CSV (coma como separador; Excel lo abre sin problema)
    const lines = [headers, ...rows]
      .map(cols => cols.map(v => {
        const s = String(v ?? "");
        // escapar comas, comillas y saltos de línea
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","))
      .join("\n");

    const blob = new Blob([lines], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `padel_resultados_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Nuevo torneo ----
  function newTournament(hardReset = true) {
    // 1) nuevo ID
    const id = uid();
    setTournamentId(id);

    // 2) limpiar calendario e historiales de emparejamientos
    setSchedule([]);
    setHistory({ teammateCounts: {}, matchupCounts: {} });

    // 3) opcional: reiniciar también jugadores/equipos
    if (hardReset) {
      setPlayers([]);
      setTeams([]);
    }

    // 4) (opcional) antes registraba en Sheets, ahora no-op
    logToSheets("new_tournament", { mode, tournamentId: id });

    // 5) feedback visual
    alert("¡Nuevo torneo creado! ✅");
  }

  // ---- Sheets logger desactivado ----
  function logToSheets(_eventType, _payload) {
    // Deshabilitado. Antes se usaba para enviar datos a Google Sheets.
    // Ahora no hace nada.
  }
  // ---------- Render ----------  
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 backdrop-blur bg-white/75 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Trophy className="w-6 h-6" />
          <h1 className="text-xl font-bold">Padel Round Robin</h1>
          <div className="ml-auto flex items-center gap-2">
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid md:grid-cols-3 gap-6">
        {/* Left: Gestión */}
        <section className="md:col-span-1">
          <div className="bg-white rounded-2xl shadow p-4 space-y-4">
            <div className="flex items-center gap-2"><Settings className="w-5 h-5" /><h2 className="font-semibold">Gestión General</h2></div>

            <div className="flex gap-2 text-sm">
              <button onClick={() => setMode(MODES.INDIVIDUAL)} className={`px-3 py-1.5 rounded-xl border ${mode === MODES.INDIVIDUAL ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-900 border-slate-300"}`}>Individual</button>
              <button onClick={() => setMode(MODES.TEAMS)} className={`px-3 py-1.5 rounded-xl border ${mode === MODES.TEAMS ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-900 border-slate-300"}`}>Equipos fijos</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Inputs móviles friendly */}
              <label className="text-sm">Rondas
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={roundsStr}
                  onChange={(e) => setRoundsStr(e.target.value)}
                  onBlur={commitRounds}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="5"
                />
              </label>

              <label className="text-sm">Canchas
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={courtsStr}
                  onChange={(e) => setCourtsStr(e.target.value)}
                  onBlur={commitCourts}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="2"
                />
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => newTournament()}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 active:scale-[0.98] shadow-sm transition-transform"
                >
                  <Trophy className="w-4 h-4" />
                  Nuevo torneo
                </button>
              </div>
              <p className="text-xs text-slate-500 text-center">
                Reinicia el torneo con un nuevo calendario y estadísticas.
              </p>
            </div>
            {mode === MODES.INDIVIDUAL ? (
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <label className="flex-1 text-sm">Agregar jugador
                    <input value={nameInput} onChange={e => setNameInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addPlayer(); }} placeholder="Nombre" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                  </label>
                  <button onClick={addPlayer} className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Jugadores: {players.length}</span>
                  <button onClick={clearAll} className="inline-flex items-center gap-1 text-red-600 hover:underline"><Trash2 className="w-4 h-4" /> Limpiar todo</button>
                </div>
                <ul className="max-h-48 overflow-auto divide-y border rounded-xl">
                  <AnimatePresence>
                    {players.map(p => (
                      <motion.li key={p.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="px-3 py-2 flex items-center justify-between">
                        <span>{p.name}</span>
                        <button onClick={() => removePlayer(p.id)} className="text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="text-sm text-slate-600">Crea equipos desde jugadores (pares aleatorios).
                  <div className="mt-2 flex gap-2">
                    <button onClick={createTeamsAuto} className="px-3 py-2 rounded-xl bg-slate-900 text-white">Formar equipos</button>
                    <button onClick={() => setTeams([])} className="px-3 py-2 rounded-xl border">Reiniciar</button>
                  </div>
                </div>
                <div className="space-y-2">
                  {teams.length === 0 && <div className="text-sm text-slate-500">No hay equipos aún.</div>}
                  <ul className="space-y-2 max-h-48 overflow-auto pr-1">
                    {teams.map(t => (
                      <li key={t.id} className="border rounded-xl p-2">
                        <div className="font-medium">{t.name}</div>
                        <div className="text-sm text-slate-600">{t.players.map(p => p.name).join(" · ")}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="pt-2 flex gap-2">
              <button disabled={!canGenerate} onClick={generateSchedule} className={`flex-1 px-4 py-2 rounded-xl text-white ${canGenerate ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-300"}`}>
                <PlayCircle className="inline w-4 h-4 mr-2" /> Generar
              </button>
              <button onClick={randomizeNextRound} className="px-4 py-2 rounded-xl border flex items-center gap-2"><Shuffle className="w-4 h-4" /> Nueva ronda</button>
            </div>
          </div>

          <div className="mt-6 bg-white rounded-2xl shadow p-4">
            <div className="flex items-center gap-2 mb-2"><Users className="w-5 h-5" /><h3 className="font-semibold">Pistas y formato</h3></div>
            <p className="text-sm text-slate-600">En modo <b>Individual</b>, cada ronda crea parejas nuevas procurando no repetir compañeros u oponentes. En <b>Equipos fijos</b> se usa round-robin clásico.</p>
          </div>
        </section>

        {/* Right: Calendario + Marcadores */}
        <section className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center gap-2 mb-2"><CalendarIcon /><h2 className="font-semibold">Calendario y Marcadores</h2></div>
            {schedule.length === 0 ? (
              <div className="text-sm text-slate-500">Genera tu primera ronda para ver los partidos.</div>
            ) : (
              <div className="space-y-6">
                {schedule.map((matches, rIdx) => (
                  <div key={rIdx} className="border rounded-2xl p-3">
                    {/* Encabezado de la ronda */}
                    <div className="flex items-start justify-between mb-3 gap-3">
                      <div>
                        <div className="font-semibold">Ronda {rIdx + 1}</div>
                        {mode === MODES.INDIVIDUAL && (() => {
                          const resting = restingPlayersForRound(matches, players);
                          if (!resting.length) return null;
                          return (
                            <div className="mt-1 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                              <span className="font-medium">Descansan:&nbsp;</span>
                              {resting.map(p => p.name).join(", ")}
                            </div>
                          );
                        })()}
                      </div>

                      <button
                        onClick={() => setSchedule(prev => prev.filter((_, i) => i !== rIdx))}
                        className="text-slate-400 hover:text-red-600"
                        title="Eliminar ronda"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Cuerpo: partidos de la ronda */}
                    <div className="grid md:grid-cols-2 gap-3">
                      {matches.length === 0 && (
                        <div className="text-sm text-slate-500">No hay partidos para esta ronda.</div>
                      )}

                      {matches.map((m, mIdx) => (
                        <div key={m.id} className="border rounded-xl p-3">
                          <div className="text-xs text-slate-500 mb-1">Cancha {mIdx + 1}</div>
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <TeamLabel team={m.teamA} nameOverride={m.teamNameA} />
                              <TeamLabel team={m.teamB} nameOverride={m.teamNameB} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <ScoreField
                                value={m.scoreA}
                                onCommit={(v) => updateScore(rIdx, mIdx, 'scoreA', v)}
                              />
                              <ScoreField
                                value={m.scoreB}
                                onCommit={(v) => updateScore(rIdx, mIdx, 'scoreB', v)}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* ===== Tabla General + Export ===== */}
          <div className="bg-white rounded-2xl shadow p-4 mt-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Tabla general</h2>
              <button
                onClick={exportStandingsCSV}
                className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-sm"
              >
                Descargar resultados
              </button>
            </div>

            {standings.length === 0 ? (
              <div className="text-sm text-slate-500">Juega o genera rondas para ver la tabla.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-500">
                    <tr>
                      <th className="py-2 pr-3">Pos</th>
                      <th className="py-2 pr-3">Nombre</th>
                      <th className="py-2 pr-3">PJ</th>
                      <th className="py-2 pr-3">PG</th>
                      <th className="py-2 pr-3">PE</th>
                      <th className="py-2 pr-3">PP</th>
                      <th className="py-2 pr-3">GF</th>
                      <th className="py-2 pr-3">GC</th>
                      <th className="py-2 pr-3">DG</th>
                      <th className="py-2 pr-3">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((r, i) => (
                      <tr key={r.id ?? r.name} className="border-t">
                        <td className="py-2 pr-3">{i + 1}</td>
                        <td className="py-2 pr-3">{r.name ?? r.teamName ?? "—"}</td>
                        <td className="py-2 pr-3">{r.pj ?? 0}</td>
                        <td className="py-2 pr-3">{(r.pg ?? r.win) ?? 0}</td>
                        <td className="py-2 pr-3">{(r.pe ?? r.draw) ?? 0}</td>
                        <td className="py-2 pr-3">{(r.pp ?? r.loss) ?? 0}</td>
                        <td className="py-2 pr-3">{r.gf ?? 0}</td>
                        <td className="py-2 pr-3">{r.gc ?? 0}</td>
                        <td className="py-2 pr-3">{(r.dg ?? ((r.gf ?? 0) - (r.gc ?? 0)))}</td>
                        <td className="py-2 pr-3 font-medium">{r.pts ?? r.points ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-10 text-center text-xs text-slate-500">
        Padel Round Robin by Velno V1 - ABR
      </footer>
    </div >
  );
}

function TeamLabel({ team, nameOverride }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex -space-x-2">
        {team.map(p => (
          <div key={p.id} title={p.name} className="w-6 h-6 rounded-full bg-slate-200 border border-white grid place-items-center text-[10px] font-medium">
            {initials(p.name)}
          </div>
        ))}
      </div>
      <div className="text-sm">{nameOverride || team.map(p => p.name).join(" + ")}</div>
    </div>
  );
}

// --- Campo de marcador con edición libre y confirmación en blur/Enter ---
function ScoreField({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [inputStr, setInputStr] = useState<string>(String(value ?? 0));

  // si el valor viene de fuera, sincroniza el texto
  useEffect(() => {
    setInputStr(String(value ?? 0));
  }, [value]);

  // Sólo dígitos o vacío mientras escribes (hasta 2 dígitos)
  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const s = e.target.value;
    if (s === "" || /^[0-9]{0,2}$/.test(s)) setInputStr(s);
  }

  // Confirmar al salir o con Enter
  function commit() {
    const n = parseInt(inputStr, 10);
    const next = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : (value ?? 0);
    setInputStr(String(next));
    if (next !== value) onCommit(next);
  }

  return (
    <input
      type="tel"
      inputMode="numeric"
      pattern="[0-9]*"
      value={inputStr}
      onChange={onChange}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-16 text-center rounded-xl border border-slate-300 px-2 py-1.5"
      placeholder="0"
    />
  );
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

function computeStandings(mode, schedule, players, teams) {
  const table = new Map();

  const addRow = (id, name) => {
    if (!table.has(id)) table.set(id, { id, name, pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, pts: 0 });
  };

  if (mode === MODES.INDIVIDUAL) {
    players.forEach(p => addRow(p.id, p.name));
  } else {
    teams.forEach(t => addRow(t.id, t.name));
  }

  schedule.forEach((matches) => {
    matches.forEach((m) => {
      const aGF = m.scoreA || 0; const bGF = m.scoreB || 0;
      if (mode === MODES.INDIVIDUAL) {
        for (const p of m.teamA) addRow(p.id, p.name);
        for (const p of m.teamB) addRow(p.id, p.name);
        for (const p of m.teamA) upd(table, p.id, aGF, bGF);
        for (const p of m.teamB) upd(table, p.id, bGF, aGF);
        const result = aGF === bGF ? "D" : (aGF > bGF ? "A" : "B");
        if (result === "A") { for (const p of m.teamA) win(table, p.id); for (const p of m.teamB) loss(table, p.id); }
        if (result === "B") { for (const p of m.teamB) win(table, p.id); for (const p of m.teamA) loss(table, p.id); }
        if (result === "D") { for (const p of [...m.teamA, ...m.teamB]) draw(table, p.id); }
      } else {
        const teamAId = (m.teamNameA && teams.find(t => t.name === m.teamNameA)?.id) || teamKey(m.teamA);
        const teamBId = (m.teamNameB && teams.find(t => t.name === m.teamNameB)?.id) || teamKey(m.teamB);
        const teamAName = (teams.find(t => t.id === teamAId)?.name) || m.teamA.map(p => p.name).join(" + ");
        const teamBName = (teams.find(t => t.id === teamBId)?.name) || m.teamB.map(p => p.name).join(" + ");
        addRow(teamAId, teamAName); addRow(teamBId, teamBName);
        upd(table, teamAId, aGF, bGF); upd(table, teamBId, bGF, aGF);
        if (aGF > bGF) { win(table, teamAId); loss(table, teamBId); }
        else if (bGF > aGF) { win(table, teamBId); loss(table, teamAId); }
        else { draw(table, teamAId); draw(table, teamBId); }
      }
    });
  });

  return Array.from(table.values()).sort((x, y) => y.pts - x.pts || (y.gf - y.gc) - (x.gf - x.gc) || y.gf - x.gf);
}

function teamKey(players) { return players.map(p => p.id).sort().join("_"); }
function restingPlayersForRound(matches, allPlayers) {
  // Jugadores que sí juegan en esta ronda
  const playing = new Set();
  for (const m of matches) {
    for (const p of m.teamA) playing.add(p.id);
    for (const p of m.teamB) playing.add(p.id);
  }
  // Los que NO están en ninguna pista = descansan
  return allPlayers.filter(p => !playing.has(p.id));
}
function upd(table, id, gf, gc) { const r = table.get(id); r.pj += 1; r.gf += gf; r.gc += gc; table.set(id, r); }
function win(table, id) { const r = table.get(id); r.pg += 1; r.pts += 3; table.set(id, r); }
function draw(table, id) { const r = table.get(id); r.pe += 1; r.pts += 1; table.set(id, r); }
function loss(table, id) { const r = table.get(id); r.pp += 1; table.set(id, r); }

function CalendarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-slate-700">
      <path d="M7 2v3M17 2v3M4 11h16M4 7h16M6 21h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
