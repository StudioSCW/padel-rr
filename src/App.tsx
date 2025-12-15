// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Shuffle,
  Trophy,
  Users,
  Settings,
  PlayCircle,
} from "lucide-react";

/**
 * Padel Round Robin
 * - Individual (parejas rotativas) y Equipos fijos (round-robin clásico)
 * - Rondas, canchas, marcadores, tabla general (3/1/0)
 * - Persistencia local
 * - Exportar CSV
 */

const MODES = { INDIVIDUAL: "INDIVIDUAL", TEAMS: "TEAMS" } as const;

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function shuffleArray<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- HELPER: elegir partidos balanceando "menos jugados" ----------
function pickBalancedMatches(
  playable: any[], // array de [TeamA, TeamB]
  courts: number,
  gamesCount: Map<string, number> // PJ acumulados por equipo
) {
  const chosen: any[] = [];
  const used = new Set<string>();

  const score = ([A, B]: any[]) =>
    (gamesCount.get(A.id) || 0) + (gamesCount.get(B.id) || 0);

  const sorted = playable.slice().sort((m1, m2) => score(m1) - score(m2));

  for (const [A, B] of sorted) {
    if (chosen.length >= courts) break;
    if (used.has(A.id) || used.has(B.id)) continue; // un solo partido por ronda

    chosen.push([A, B]);
    used.add(A.id);
    used.add(B.id);

    gamesCount.set(A.id, (gamesCount.get(A.id) || 0) + 1);
    gamesCount.set(B.id, (gamesCount.get(B.id) || 0) + 1);
  }

  return chosen;
}

// ---------- HELPER: reconstruir PJ desde el schedule (para "Nueva ronda") ----------
function buildGamesCountFromSchedule(
  teams: any[],
  schedule: any[],
  mode: string
) {
  const map = new Map<string, number>(teams.map((t: any) => [t.id, 0]));
  if (!schedule || schedule.length === 0) return map;

  for (const round of schedule) {
    const matches = mode === MODES.TEAMS ? round : round.matches;
    if (!matches) continue;
    for (const m of matches) {
      const a = m.teamIdA;
      const b = m.teamIdB;
      if (a) map.set(a, (map.get(a) || 0) + 1);
      if (b) map.set(b, (map.get(b) || 0) + 1);
    }
  }

  return map;
}

// ---------- TEAM RR (método del círculo) ----------
function generateTeamRoundRobin(teams: any[], roundsLimit?: number) {
  const n = teams.length;
  if (n < 2) return [] as any[][];

  const base = shuffleArray(teams);

  const isOdd = base.length % 2 === 1;
  const list = isOdd
    ? [...base, { id: "BYE", name: "BYE", players: [] }]
    : [...base];

  const m = list.length;
  const totalRounds = roundsLimit ? clamp(roundsLimit, 1, m - 1) : m - 1;

  const arr = [...list];
  const rounds: any[][] = [];

  for (let r = 0; r < totalRounds; r++) {
    const pairings: any[] = [];
    for (let i = 0; i < m / 2; i++) {
      pairings.push([arr[i], arr[m - 1 - i]]);
    }
    rounds.push(pairings);

    const last = arr.pop();
    if (last !== undefined) {
      arr.splice(1, 0, last);
    }
  }

  return rounds;
}

// ---------- INDIVIDUAL (greedy con penalizaciones) ----------
function generateIndividualSchedule(
  players: any[],
  rounds: number,
  courts: number,
  history: any = {}
) {
  const teammateCounts = history.teammateCounts || {};
  const matchupCounts = history.matchupCounts || {};
  const prevRest = history.restCounts || {};

  const roundsOut: any[] = [];
  const restCounts: Record<string, number> = { ...prevRest };

  for (let r = 0; r < rounds; r++) {
    const pool = shuffleArray(players);

    const usableBlocks = Math.min(Math.floor(pool.length / 4), courts);
    const playersInUse = usableBlocks * 4;
    const restNeeded = Math.max(0, pool.length - playersInUse);

    let resting: any[] = [];
    if (restNeeded > 0) {
      pool.sort((a, b) => (restCounts[a.id] || 0) - (restCounts[b.id] || 0));
      resting = pool.splice(0, restNeeded);
      for (const p of resting) restCounts[p.id] = (restCounts[p.id] || 0) + 1;
    }

    const available = pool;
    const matches: any[] = [];

    while (available.length >= 4 && matches.length < courts) {
      let bestQuad: any = null;
      let bestScore = Infinity;

      for (let i = 0; i < available.length; i++) {
        for (let j = i + 1; j < available.length; j++) {
          for (let k = j + 1; k < available.length; k++) {
            for (let l = k + 1; l < available.length; l++) {
              const cand = [
                available[i],
                available[j],
                available[k],
                available[l],
              ];
              const pairings = [
                [
                  [cand[0], cand[1]],
                  [cand[2], cand[3]],
                ],
                [
                  [cand[0], cand[2]],
                  [cand[1], cand[3]],
                ],
                [
                  [cand[0], cand[3]],
                  [cand[1], cand[2]],
                ],
              ];
              for (const p of pairings) {
                const score = pairingPenalty(
                  p as any,
                  teammateCounts,
                  matchupCounts
                );
                if (score < bestScore) {
                  bestScore = score;
                  bestQuad = { cand, p };
                }
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
        teamA: bestQuad.p[0].map((p: any) => p),
        teamB: bestQuad.p[1].map((p: any) => p),
        scoreA: 0,
        scoreB: 0,
        played: false,
        id: uid(),
      };

      const [a1, a2] = match.teamA;
      const [b1, b2] = match.teamB;
      incPair(teammateCounts, a1.id, a2.id);
      incPair(teammateCounts, b1.id, b2.id);
      for (const x of [a1, a2])
        for (const y of [b1, b2]) incPair(matchupCounts, x.id, y.id);

      matches.push(match);
    }

    roundsOut.push({ matches, resting });
  }

  return {
    rounds: roundsOut,
    history: { teammateCounts, matchupCounts, restCounts },
  };
}

function pairingPenalty(
  pairings: any[],
  teammateCounts: any,
  matchupCounts: any
) {
  let score = 0;
  const wTeam = 10;
  const wOpp = 2;
  const seenPairs = new Set<string>();
  const pairKey = (a: any, b: any) => [a.id, b.id].sort().join("|");

  for (const team of pairings) {
    const [p1, p2] = team;
    const k = pairKey(p1, p2);
    if (!seenPairs.has(k)) {
      const tcount = teammateCounts[p1.id]?.[p2.id] || 0;
      score += wTeam * tcount;
      seenPairs.add(k);
    }
  }
  const [tA, tB] = pairings;
  for (const a of tA)
    for (const b of tB) {
      const c = matchupCounts[a.id]?.[b.id] || 0;
      score += wOpp * c;
    }
  return score;
}

function incPair(matrix: any, a: string, b: string) {
  if (!matrix[a]) matrix[a] = {};
  if (!matrix[b]) matrix[b] = {};
  matrix[a][b] = (matrix[a][b] || 0) + 1;
  matrix[b][a] = (matrix[b][a] || 0) + 1;
}

// ---------- STORAGE ----------
const STORE_KEY = "padel-rr-v1";
const loadStore = () => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "null") || null;
  } catch {
    return null;
  }
};
const saveStore = (data: any) =>
  localStorage.setItem(STORE_KEY, JSON.stringify(data));

// ---------- APP ----------
export default function App() {
  const [mode, setMode] = useState<string>(MODES.INDIVIDUAL);
  const [players, setPlayers] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [teamNameInput, setTeamNameInput] = useState("");
  const [teamP1Input, setTeamP1Input] = useState("");
  const [teamP2Input, setTeamP2Input] = useState("");
  const [rounds, setRounds] = useState<number>(5);
  const [courts, setCourts] = useState<number>(2);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [history, setHistory] = useState<any>({
    teammateCounts: {},
    matchupCounts: {},
    restCounts: {},
  });
  const [standings, setStandings] = useState<any[]>([]);
  const [tournamentId, setTournamentId] = useState<string>(() => uid());
  const [teamPlan, setTeamPlan] = useState<any[] | null>(null);
  const [teamRoundIdx, setTeamRoundIdx] = useState<number>(0);

  useEffect(() => {
    setTeamPlan(null);
    setTeamRoundIdx(0);
  }, [teams]);

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
      setHistory(
        s.history || { teammateCounts: {}, matchupCounts: {}, restCounts: {} }
      );
      setTournamentId(s.tournamentId || uid());
    }
  }, []);

  // Persist
  useEffect(() => {
    saveStore({
      mode,
      players,
      teams,
      rounds,
      courts,
      schedule,
      history,
      tournamentId,
    });
  }, [mode, players, teams, rounds, courts, schedule, history, tournamentId]);

  useEffect(() => {
    setStandings(computeStandings(mode, schedule, players, teams));
  }, [schedule, mode, players, teams]);
  // Resumen para mostrar arriba de la tabla general (modo, equipos, rondas, etc.)
  const gamesBalanceInfo = useMemo(() => {
    // Solo aplica a modo Equipos fijos
    if (mode !== MODES.TEAMS || teams.length === 0 || schedule.length === 0) {
      return null;
    }

    // Usamos el helper que ya tienes para contar partidos jugados por equipo
    const gamesCount = buildGamesCountFromSchedule(teams, schedule, MODES.TEAMS);

    let min = Infinity;
    let max = -Infinity;

    gamesCount.forEach((pj) => {
      if (pj < min) min = pj;
      if (pj > max) max = pj;
    });

    if (!isFinite(min) || !isFinite(max)) return null;
    return { min, max };
  }, [mode, teams, schedule]);

  const canGenerate = useMemo(() => {
    if (mode === MODES.INDIVIDUAL)
      return players.length >= 4 && courts >= 1 && rounds >= 1;
    if (mode === MODES.TEAMS) return teams.length >= 2 && courts >= 1 && rounds >= 1;
    return false;
  }, [mode, players, teams, courts, rounds]);

  const [roundsDraft, setRoundsDraft] = useState<string>(() => String(rounds));
  const [courtsDraft, setCourtsDraft] = useState<string>(() => String(courts));

  useEffect(() => setRoundsDraft(String(rounds)), [rounds]);
  useEffect(() => setCourtsDraft(String(courts)), [courts]);

  useEffect(() => {
    setSchedule([]);
  }, [mode]);

  function commitRounds() {
    const n = clamp(parseInt(roundsDraft || "0", 10) || 0, 1, 20);
    setRounds(n);
    setRoundsDraft(String(n));
  }
  function commitCourts() {
    const n = clamp(parseInt(courtsDraft || "0", 10) || 0, 1, 12);
    setCourts(n);
    setCourtsDraft(String(n));
  }

  // ---------- Actions ----------
  function addPlayer() {
    const n = nameInput.trim();
    if (!n) return;
    if (players.some((p) => p.name.toLowerCase() === n.toLowerCase())) return;
    setPlayers([...players, { id: uid(), name: n }]);
    setNameInput("");
  }
  function removePlayer(id: string) {
    setPlayers(players.filter((p) => p.id !== id));
  }

  function createTeamsAuto() {
    const even = players.length - (players.length % 2);
    const ps = shuffleArray(players.slice(0, even));
    const t: any[] = [];
    for (let i = 0; i < ps.length; i += 2) {
      const a = ps[i],
        b = ps[i + 1];
      t.push({
        id: uid(),
        name: `${a.name} & ${b.name}`.slice(0, 40),
        players: [a, b],
      });
    }
    setTeams(t);
  }

  function addTeamManual() {
    const p1 = teamP1Input.trim();
    const p2 = teamP2Input.trim();
    if (!p1 || !p2) {
      alert("Debes ingresar el nombre de los dos jugadores.");
      return;
    }

    const teamName = (teamNameInput.trim() || `${p1} & ${p2}`).slice(0, 40);

    const playerA = { id: uid(), name: p1 };
    const playerB = { id: uid(), name: p2 };

    setTeams((prev) => [
      ...prev,
      {
        id: uid(),
        name: teamName,
        players: [playerA, playerB],
      },
    ]);

    setTeamNameInput("");
    setTeamP1Input("");
    setTeamP2Input("");
  }

  function removeTeam(id: string) {
    setTeams((prev) => prev.filter((t) => t.id !== id));
  }

  function clearAll() {
    setPlayers([]);
    setTeams([]);
    setSchedule([]);
    setHistory({ teammateCounts: {}, matchupCounts: {}, restCounts: {} });
  }

  function generateSchedule() {
    commitRounds();
    commitCourts();

    if (mode === MODES.TEAMS) {
      const fullPlan = generateTeamRoundRobin(teams);
      if (!fullPlan || fullPlan.length === 0) {
        setSchedule([]);
        setTeamPlan(null);
        setTeamRoundIdx(0);
        return;
      }

      const needed = rounds;
      const extended: any[] = [];
      const cycles = Math.ceil(needed / fullPlan.length);

      for (let c = 0; c < cycles; c++) {
        for (let r = 0; r < fullPlan.length; r++) {
          if (extended.length >= needed) break;

          const originalPairings = fullPlan[r];
          const rotated = originalPairings.slice().map((_, idx) => {
            const newIdx = (idx + c) % originalPairings.length;
            return originalPairings[newIdx];
          });

          extended.push(rotated);
        }
      }

      setTeamPlan(extended);
      setTeamRoundIdx(0);

      const gamesCount = new Map<string, number>(
        teams.map((t: any) => [t.id, 0])
      );

      const sched = extended.map((pairings: any[]) => {
        const playable = pairings.filter(
          ([A, B]: any[]) => A.id !== "BYE" && B.id !== "BYE"
        );
        const chosen = pickBalancedMatches(playable, courts, gamesCount);

        return chosen.map(([A, B]: any[]) => ({
          id: uid(),
          teamA: A.players,
          teamB: B.players,
          teamNameA: A.name,
          teamNameB: B.name,
          teamIdA: A.id,
          teamIdB: B.id,
          scoreA: 0,
          scoreB: 0,
          played: false,
        }));
      });

      setSchedule(sched);
      return;
    }

    const { rounds: rr, history: h } = generateIndividualSchedule(
      players,
      rounds,
      courts,
      history
    );
    setSchedule(rr);
    setHistory(h);
  }

  function updateScore(
    rIdx: number,
    mIdx: number,
    field: "scoreA" | "scoreB",
    val: string
  ) {
    const v = clamp(parseInt(val || "0", 10) || 0, 0, 99);

    setSchedule((prev: any[]) =>
      prev.map((round: any, i: number) => {
        if (i !== rIdx) return round;
        if (mode === MODES.TEAMS) {
          return round.map((m: any, j: number) =>
            j !== mIdx ? m : { ...m, [field]: v, played: true }
          );
        } else {
          return {
            ...round,
            matches: round.matches.map((m: any, j: number) =>
              j !== mIdx ? m : { ...m, [field]: v, played: true }
            ),
          };
        }
      })
    );
  }

  function resetTable() {
    setSchedule((prev: any[]) =>
      prev.map((round: any) => {
        if (mode === MODES.TEAMS) {
          return round.map((m: any) => ({
            ...m,
            scoreA: 0,
            scoreB: 0,
            played: false,
          }));
        } else {
          return {
            ...round,
            matches: round.matches.map((m: any) => ({
              ...m,
              scoreA: 0,
              scoreB: 0,
              played: false,
            })),
          };
        }
      })
    );
  }


  function resetRoundScores(rIdx: number) {
    setSchedule((prev: any[]) =>
      prev.map((round: any, i: number) => {
        if (i !== rIdx) return round;

        if (mode === MODES.TEAMS) {
          // TEAMS: round es un array de partidos
          return round.map((m: any) => ({
            ...m,
            scoreA: 0,
            scoreB: 0,
          }));
        } else {
          // INDIVIDUAL: round = { matches, resting }
          return {
            ...round,
            matches: round.matches.map((m: any) => ({
              ...m,
              scoreA: 0,
              scoreB: 0,
            })),
          };
        }
      })
    );
  }

  function randomizeNextRound() {
    commitRounds();
    commitCourts();

    if (mode === MODES.INDIVIDUAL) {
      const { rounds: rr, history: h } = generateIndividualSchedule(
        players,
        1,
        courts,
        history
      );
      setSchedule((prev: any[]) => [...prev, rr[0]]);
      setHistory(h);
      return;
    }

    if (!teamPlan || teamPlan.length === 0) {
      const fullPlan = generateTeamRoundRobin(teams);
      if (!fullPlan || fullPlan.length === 0) return;

      setTeamPlan(fullPlan);
      setTeamRoundIdx(0);

      const pairings = fullPlan[0] || [];
      const playable = pairings.filter(
        ([A, B]: any[]) => A.id !== "BYE" && B.id !== "BYE"
      );

      const gamesCount = buildGamesCountFromSchedule(
        teams,
        schedule,
        MODES.TEAMS
      );
      const chosen = pickBalancedMatches(playable, courts, gamesCount);

      const schedRound = chosen.map(([A, B]: any[]) => ({
        id: uid(),
        teamA: A.players,
        teamB: B.players,
        teamNameA: A.name,
        teamNameB: B.name,
        teamIdA: A.id,
        teamIdB: B.id,
        scoreA: 0,
        scoreB: 0,
        played: false
      }));

      setSchedule((prev: any[]) => [...prev, schedRound]);
      setTeamRoundIdx(1 % fullPlan.length);
      return;
    }

    const idx = teamRoundIdx % teamPlan.length;
    const pairings = teamPlan[idx] || [];
    const playable = pairings.filter(
      ([A, B]: any[]) => A.id !== "BYE" && B.id !== "BYE"
    );

    const gamesCount = buildGamesCountFromSchedule(
      teams,
      schedule,
      MODES.TEAMS
    );
    const chosen = pickBalancedMatches(playable, courts, gamesCount);

    const schedRound = chosen.map(([A, B]: any[]) => ({
      id: uid(),
      teamA: A.players,
      teamB: B.players,
      teamNameA: A.name,
      teamNameB: B.name,
      teamIdA: A.id,
      teamIdB: B.id,
      scoreA: 0,
      scoreB: 0,
      played: false
    }));

    setSchedule((prev: any[]) => [...prev, schedRound]);
    setTeamRoundIdx((n) => n + 1);
  }

  function exportStandingsCSV() {
    if (!standings || standings.length === 0) {
      alert("No hay resultados para exportar todavía.");
      return;
    }
    const headers = [
      "Pos",
      "Nombre",
      "PJ",
      "PG",
      "PE",
      "PP",
      "GF",
      "GC",
      "DG",
      "Pts",
    ];
    const rows = standings.map((r: any, i: number) => [
      i + 1,
      r.name ?? r.teamName ?? "—",
      r.pj ?? 0,
      r.pg ?? r.win ?? 0,
      r.pe ?? r.draw ?? 0,
      r.pp ?? r.loss ?? 0,
      r.gf ?? 0,
      r.gc ?? 0,
      r.dg ?? (r.gf ?? 0) - (r.gc ?? 0),
      r.pts ?? r.points ?? 0,
    ]);
    const lines = [headers, ...rows]
      .map((cols) =>
        cols
          .map((v) => {
            const s = String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
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

  function exportScheduleCSV() {
    if (!schedule || schedule.length === 0) {
      alert("No hay calendario para exportar todavía.");
      return;
    }

    const headers = [
      "Ronda",
      "Cancha",
      "Equipo A",
      "Equipo B",
      "Score A",
      "Score B",
      "Jugado",
    ];

    const rows: any[] = [];

    schedule.forEach((round: any, rIdx: number) => {
      const matches = mode === MODES.TEAMS ? (round as any[]) : round.matches;

      (matches || []).forEach((m: any, mIdx: number) => {
        const nameA =
          m.teamNameA ||
          (m.teamA ? m.teamA.map((p: any) => p.name).join(" + ") : "—");

        const nameB =
          m.teamNameB ||
          (m.teamB ? m.teamB.map((p: any) => p.name).join(" + ") : "—");

        rows.push([
          rIdx + 1,
          mIdx + 1,
          nameA,
          nameB,
          m.scoreA ?? 0,
          m.scoreB ?? 0,
          m.played ? "SI" : "NO",
        ]);
      });
    });

    const lines = [headers, ...rows]
      .map((cols) =>
        cols
          .map((v) => {
            const s = String(v ?? "");
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      )
      .join("\n");

    const blob = new Blob([lines], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `padel_calendario_${date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function newTournament(opts: { hardResetPlayersTeams?: boolean } = {}) {
    const { hardResetPlayersTeams = true } = opts;

    try {
      localStorage.removeItem(STORE_KEY);
    } catch { }

    setTournamentId(uid());
    setSchedule([]);
    setHistory({ teammateCounts: {}, matchupCounts: {}, restCounts: {} });

    if (hardResetPlayersTeams) {
      setPlayers([]);
      setTeams([]);
    }

    alert("¡Nuevo torneo creado! ✅");
  }

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-40 backdrop-blur bg-white/75 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Trophy className="w-6 h-6" />
          <h1 className="text-xl font-bold">Padel Round Robin – Velno Edition</h1>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid md:grid-cols-3 gap-6">
        {/* IZQ: Gestión */}
        <section className="md:col-span-1">
          <div className="bg-white rounded-2xl shadow p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              <h2 className="font-semibold">Gestión General</h2>
            </div>

            <div className="flex gap-2 text-sm">
              <button
                onClick={() => {
                  setSchedule([]);
                  setMode(MODES.INDIVIDUAL);
                }}
                className={`px-3 py-1.5 rounded-xl border ${mode === MODES.INDIVIDUAL
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-900 border-slate-300"
                  }`}
              >
                Individual
              </button>

              <button
                onClick={() => {
                  setSchedule([]);
                  setMode(MODES.TEAMS);
                }}
                className={`px-3 py-1.5 rounded-xl border ${mode === MODES.TEAMS
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-900 border-slate-300"
                  }`}
              >
                Equipos fijos
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                Rondas
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={roundsDraft}
                  onChange={(e) => setRoundsDraft(e.target.value)}
                  onBlur={commitRounds}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="5"
                />
              </label>
              <label className="text-sm">
                Canchas
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={courtsDraft}
                  onChange={(e) => setCourtsDraft(e.target.value)}
                  onBlur={commitCourts}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                  placeholder="2"
                />
              </label>
            </div>

            <div className="space-y-2">
              {/* Nuevo torneo completo (borra todo) */}
              <button
                onClick={() => newTournament({ hardResetPlayersTeams: true })}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white"
              >
                <PlayCircle className="w-4 h-4" />
                Nuevo torneo (todo)
              </button>

              {/* Solo resetear calendario y resultados, manteniendo jugadores/equipos */}
              <button
                onClick={() => newTournament({ hardResetPlayersTeams: false })}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-indigo-200 text-indigo-700 bg-indigo-50"
              >
                <Shuffle className="w-4 h-4" />
                Reiniciar calendario
              </button>

              <p className="text-xs text-slate-500">
                <b>Nuevo torneo (todo):</b> borra jugadores, equipos, calendario y tabla.
                <br />
                <b>Reiniciar calendario:</b> genera un nuevo calendario manteniendo los equipos.
              </p>
            </div>

            {mode === MODES.INDIVIDUAL ? (
              <div className="space-y-3">
                <div className="flex items-end gap-2">
                  <label className="flex-1 text-sm">
                    Agregar jugador
                    <input
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addPlayer();
                      }}
                      placeholder="Nombre"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    />
                  </label>
                  <button
                    onClick={addPlayer}
                    className="px-3 py-2 rounded-xl bg-emerald-600 text-white hover:opacity-90"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Jugadores: {players.length}</span>
                  <button
                    onClick={clearAll}
                    className="inline-flex items-center gap-1 text-red-600 hover:underline"
                  >
                    <Trash2 className="w-4 h-4" /> Limpiar todo
                  </button>
                </div>
                <ul className="max-h-48 overflow-auto divide-y border rounded-xl">
                  {players.map((p) => (
                    <li
                      key={p.id}
                      className="px-3 py-2 flex items-center justify-between"
                    >
                      <span>{p.name}</span>
                      <button
                        onClick={() => removePlayer(p.id)}
                        className="text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium text-slate-700">
                    Agregar equipo / pareja
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      value={teamNameInput}
                      onChange={(e) => setTeamNameInput(e.target.value)}
                      placeholder="Nombre del equipo (opcional)"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        value={teamP1Input}
                        onChange={(e) => setTeamP1Input(e.target.value)}
                        placeholder="Jugador 1"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      />
                      <input
                        value={teamP2Input}
                        onChange={(e) => setTeamP2Input(e.target.value)}
                        placeholder="Jugador 2"
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      onClick={addTeamManual}
                      className="w-full mt-1 px-3 py-2 rounded-xl bg-emerald-600 text-white text-sm hover:bg-emerald-700 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Agregar equipo
                    </button>
                  </div>
                </div>

                <div className="text-sm text-slate-600 border-t pt-3">
                  También puedes crear equipos desde la lista de jugadores (pares
                  aleatorios).
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={createTeamsAuto}
                      className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm"
                    >
                      Formar equipos
                    </button>
                    <button
                      onClick={() => setTeams([])}
                      className="px-3 py-2 rounded-xl border text-sm"
                    >
                      Reiniciar
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {teams.length === 0 && (
                    <div className="text-sm text-slate-500">No hay equipos aún.</div>
                  )}
                  <ul className="space-y-2 max-h-48 overflow-auto pr-1">
                    {teams.map((t) => (
                      <li
                        key={t.id}
                        className="border rounded-xl p-2 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="font-medium text-sm">{t.name}</div>
                          <div className="text-xs text-slate-600">
                            {t.players.map((p: any) => p.name).join(" · ")}
                          </div>
                        </div>
                        <button
                          onClick={() => removeTeam(t.id)}
                          className="text-slate-400 hover:text-red-600"
                          title="Eliminar equipo"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="pt-2 flex gap-2">
              <button
                disabled={!canGenerate}
                onClick={generateSchedule}
                className={`flex-1 px-4 py-2 rounded-xl text-white ${canGenerate ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-300"
                  }`}
              >
                <PlayCircle className="inline w-4 h-4 mr-2" /> Generar
              </button>
              <button
                onClick={randomizeNextRound}
                className="px-4 py-2 rounded-xl border flex items-center gap-2"
              >
                <Shuffle className="w-4 h-4" /> Nueva ronda
              </button>
            </div>
          </div>

          <div className="mt-6 bg-white rounded-2xl shadow p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-5 h-5" />
              <h3 className="font-semibold">Pistas y formato</h3>
            </div>
            <p className="text-sm text-slate-600">
              En modo <b>Individual</b>, cada ronda crea parejas nuevas procurando no
              repetir compañeros u oponentes. En <b>Equipos fijos</b> se usa round-robin
              clásico.
            </p>
          </div>
        </section>

        {/* DER: Calendario + Marcadores */}
        <section className="md:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarIcon />
              <h2 className="font-semibold">Calendario y Marcadores</h2>
            </div>

            {schedule.length === 0 ? (
              <div className="text-sm text-slate-500">
                Genera tu primera ronda para ver los partidos.
              </div>
            ) : (
              <div className="space-y-6">
                {schedule.map((round: any, rIdx: number) => {
                  const matches =
                    mode === MODES.TEAMS ? (round as any[]) : round.matches;

                  const playingIds = new Set(
                    matches
                      .flatMap((m: any) => [m.teamIdA, m.teamIdB])
                      .filter(Boolean)
                  );
                  const restingTeams =
                    mode === MODES.TEAMS
                      ? teams.filter((t: any) => !playingIds.has(t.id))
                      : [];

                  return (
                    <div key={rIdx} className="border rounded-2xl p-3">
                      <div className="flex items-center justify-between mb-3">
                        <div className="font-semibold">Ronda {rIdx + 1}</div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => resetRoundScores(rIdx)}
                            className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                          >
                            Reiniciar marcadores
                          </button>
                          <button
                            onClick={() =>
                              setSchedule((prev: any[]) =>
                                prev.filter((_, i) => i !== rIdx)
                              )
                            }
                            className="text-slate-400 hover:text-red-600"
                            title="Eliminar ronda"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="grid md:grid-cols-2 gap-3">
                        {matches.length === 0 && (
                          <div className="text-sm text-slate-500">
                            No hay partidos para esta ronda.
                          </div>
                        )}

                        {matches.map((m: any, mIdx: number) => (
                          <div key={m.id} className="border rounded-xl p-3">
                            <div className="text-xs text-slate-500 mb-1">
                              Cancha {mIdx + 1}
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <TeamLabel
                                  team={m.teamA}
                                  nameOverride={m.teamNameA}
                                />
                                <TeamLabel
                                  team={m.teamB}
                                  nameOverride={m.teamNameB}
                                />
                              </div>
                              <div className="w-28 grid grid-cols-2 gap-2 text-center">
                                <input
                                  type="number"
                                  min={0}
                                  max={99}
                                  value={m.scoreA}
                                  onChange={(e) =>
                                    updateScore(
                                      rIdx,
                                      mIdx,
                                      "scoreA",
                                      e.target.value
                                    )
                                  }
                                  className="rounded-xl border px-2 py-1"
                                />
                                <input
                                  type="number"
                                  min={0}
                                  max={99}
                                  value={m.scoreB}
                                  onChange={(e) =>
                                    updateScore(
                                      rIdx,
                                      mIdx,
                                      "scoreB",
                                      e.target.value
                                    )
                                  }
                                  className="rounded-xl border px-2 py-1"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>

                      {mode === MODES.TEAMS && restingTeams.length > 0 && (
                        <div className="mt-3 text-sm text-slate-600">
                          <div className="font-medium">Descansan:</div>
                          <ul className="list-disc pl-5">
                            {restingTeams.map((t: any) => (
                              <li key={t.id}>{t.name}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {mode === MODES.INDIVIDUAL &&
                        round.resting &&
                        round.resting.length > 0 && (
                          <div className="mt-3 text-sm text-slate-600">
                            <div className="font-medium">Descansan:</div>
                            <ul className="list-disc pl-5">
                              {round.resting.map((p: any) => (
                                <li key={p.id}>{p.name}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ===== Tabla General + Export ===== */}
          <div className="bg-white rounded-2xl shadow p-4 mt-6">

            {/* Header: título + acciones */}
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Tabla general</h2>

              <div className="flex gap-2">
                <button
                  onClick={resetTable}
                  className="px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-sm"
                  title="Reinicia todos los marcadores y deja la tabla en cero"
                >
                  Reiniciar tabla
                </button>

                <button
                  onClick={exportStandingsCSV}
                  className="px-3 py-1.5 rounded-xl bg-slate-900 text-white text-sm"
                  title="Descarga la tabla general en CSV"
                >
                  Descargar CSV
                </button>
              </div>
            </div>

            <button
              disabled={!schedule || schedule.length === 0}
              onClick={exportScheduleCSV}
              className={`px-3 py-1.5 rounded-xl text-sm ${schedule && schedule.length > 0
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
            >
              Descargar calendario (CSV)
            </button>


            {/* Resumen rápido de configuración y equilibrio de partidos */}
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                {mode === MODES.TEAMS ? "Modo: Equipos fijos" : "Modo: Individual"}
              </span>

              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                {mode === MODES.TEAMS
                  ? `Equipos: ${teams.length}`
                  : `Jugadores: ${players.length}`}
              </span>

              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                Rondas generadas: {schedule.length}
              </span>

              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">
                Canchas: {courts}
              </span>

              {mode === MODES.TEAMS && gamesBalanceInfo && (
                <span
                  className={
                    "inline-flex items-center rounded-full px-2 py-0.5 border " +
                    (gamesBalanceInfo.max - gamesBalanceInfo.min > 1
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700")
                  }
                >
                  PJ por equipo: {gamesBalanceInfo.min}–{gamesBalanceInfo.max}
                </span>
              )}
            </div>

            {standings.length === 0 ? (
              <div className="text-sm text-slate-500">
                Juega o genera rondas para ver la tabla.
              </div>
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
                    {standings.map((r: any, i: number) => (
                      <tr key={r.id ?? r.name} className="border-t">
                        <td className="py-2 pr-3">{i + 1}</td>
                        <td className="py-2 pr-3">
                          {r.name ?? r.teamName ?? "—"}
                        </td>
                        <td className="py-2 pr-3">{r.pj ?? 0}</td>
                        <td className="py-2 pr-3">{(r.pg ?? r.win) ?? 0}</td>
                        <td className="py-2 pr-3">{(r.pe ?? r.draw) ?? 0}</td>
                        <td className="py-2 pr-3">{(r.pp ?? r.loss) ?? 0}</td>
                        <td className="py-2 pr-3">{r.gf ?? 0}</td>
                        <td className="py-2 pr-3">{r.gc ?? 0}</td>
                        <td className="py-2 pr-3">
                          {r.dg ?? (r.gf ?? 0) - (r.gc ?? 0)}
                        </td>
                        <td className="py-2 pr-3 font-medium">
                          {r.pts ?? r.points ?? 0}
                        </td>
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
        Padel Round Robin by Velno – ABR
      </footer>
    </div>
  );
}

function TeamLabel({ team, nameOverride }: any) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex -space-x-2">
        {team.map((p: any) => (
          <div
            key={p.id}
            title={p.name}
            className="w-6 h-6 rounded-full bg-slate-200 border border-white grid place-items-center text-[10px] font-medium"
          >
            {initials(p.name)}
          </div>
        ))}
      </div>
      <div className="text-sm">
        {nameOverride || team.map((p: any) => p.name).join(" + ")}
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || "") + (parts[1]?.[0] || "");
}

function computeStandings(
  mode: string,
  schedule: any[],
  players: any[],
  teams: any[]
) {
  const table = new Map<string, any>();

  const addRow = (id: string, name: string) => {
    if (!table.has(id))
      table.set(id, {
        id,
        name,
        pj: 0,
        pg: 0,
        pe: 0,
        pp: 0,
        gf: 0,
        gc: 0,
        pts: 0,
      });
  };

  if (mode === MODES.INDIVIDUAL) {
    players.forEach((p) => addRow(p.id, p.name));
  } else {
    teams.forEach((t) => addRow(t.id, t.name));
  }

  schedule.forEach((round: any) => {
    const matches = mode === MODES.TEAMS ? round : round.matches;
    matches.forEach((m: any) => {
      if (!m.played) return;

      const aGF = m.scoreA || 0;
      const bGF = m.scoreB || 0;

      if (mode === MODES.INDIVIDUAL) {
        for (const p of m.teamA) addRow(p.id, p.name);
        for (const p of m.teamB) addRow(p.id, p.name);
        for (const p of m.teamA) upd(table, p.id, aGF, bGF);
        for (const p of m.teamB) upd(table, p.id, bGF, aGF);
        if (aGF > bGF) {
          for (const p of m.teamA) win(table, p.id);
          for (const p of m.teamB) loss(table, p.id);
        } else if (bGF > aGF) {
          for (const p of m.teamB) win(table, p.id);
          for (const p of m.teamA) loss(table, p.id);
        } else {
          for (const p of [...m.teamA, ...m.teamB]) draw(table, p.id);
        }
      } else {
        const teamAId = m.teamIdA || teamKey(m.teamA);
        const teamBId = m.teamIdB || teamKey(m.teamB);
        const teamAName =
          teams.find((t: any) => t.id === teamAId)?.name ||
          m.teamA.map((p: any) => p.name).join(" + ");
        const teamBName =
          teams.find((t: any) => t.id === teamBId)?.name ||
          m.teamB.map((p: any) => p.name).join(" + ");
        addRow(teamAId, teamAName);
        addRow(teamBId, teamBName);
        upd(table, teamAId, aGF, bGF);
        upd(table, teamBId, bGF, aGF);
        if (aGF > bGF) {
          win(table, teamAId);
          loss(table, teamBId);
        } else if (bGF > aGF) {
          win(table, teamBId);
          loss(table, teamAId);
        } else {
          draw(table, teamAId);
          draw(table, teamBId);
        }
      }
    });
  });

  return Array.from(table.values()).sort(
    (x, y) =>
      y.pts - x.pts ||
      (y.gf - y.gc) - (x.gf - x.gc) ||
      y.gf - x.gf
  );
}

function teamKey(players: any[]) {
  return players
    .map((p) => p.id)
    .sort()
    .join("_");
}
function upd(table: Map<string, any>, id: string, gf: number, gc: number) {
  const r = table.get(id);
  r.pj += 1;
  r.gf += gf;
  r.gc += gc;
  table.set(id, r);
}
function win(table: Map<string, any>, id: string) {
  const r = table.get(id);
  r.pg += 1;
  r.pts += 3;
  table.set(id, r);
}
function draw(table: Map<string, any>, id: string) {
  const r = table.get(id);
  r.pe += 1;
  r.pts += 1;
  table.set(id, r);
}
function loss(table: Map<string, any>, id: string) {
  const r = table.get(id);
  r.pp += 1;
  table.set(id, r);
}

function CalendarIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="text-slate-700"
    >
      <path
        d="M7 2v3M17 2v3M4 11h16M4 7h16M6 21h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
