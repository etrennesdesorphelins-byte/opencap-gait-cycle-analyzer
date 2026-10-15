// 歩行イベント（左右の Initial Contact / Toe Off）の記録と、そこからの歩行周期の構成。
// イベントは何回でも記録でき、同側の連続するIC間を1歩行周期とみなす。

export const SIDES = ['R', 'L'];
export const EVENT_TYPES = ['IC', 'TO'];

export const SIDE_LABELS = { R: 'Right', L: 'Left' };
export const EVENT_LABELS = { IC: 'IC', TO: 'Toe Off' };

const OPPOSITE = { R: 'L', L: 'R' };

let nextEventId = 1;

export function createEventList() {
  return [];
}

// 同じ側・種類・サンプルのイベントが既にあれば追加せず false を返す
export function addEvent(events, { side, type, sampleIndex, motTime, videoTime }) {
  const duplicate = events.some(
    (e) => e.side === side && e.type === type && e.sampleIndex === sampleIndex
  );
  if (duplicate) return false;
  events.push({ id: nextEventId++, side, type, sampleIndex, motTime, videoTime });
  events.sort((a, b) => a.sampleIndex - b.sampleIndex || a.side.localeCompare(b.side) || a.type.localeCompare(b.type));
  return true;
}

export function removeEvent(events, id) {
  const idx = events.findIndex((e) => e.id === id);
  if (idx >= 0) events.splice(idx, 1);
}

export function clearEvents(events) {
  events.splice(0, events.length);
}

function eventsOf(events, side, type) {
  return events.filter((e) => e.side === side && e.type === type);
}

function firstBetween(list, startIdx, endIdx) {
  return list.find((e) => e.sampleIndex > startIdx && e.sampleIndex < endIdx) || null;
}

function percentInCycle(event, start, end) {
  if (!event) return null;
  return ((event.motTime - start.motTime) / (end.motTime - start.motTime)) * 100;
}

// 指定側の歩行周期一覧を返す。
// 各周期: 同側IC → 次の同側IC。周期内の最初の同側TOから立脚期%を算出し、
// 対側のTO/ICは周期内に記録されていれば%を付与する（両脚支持期の確認用）。
export function buildCycles(events, side) {
  const ics = eventsOf(events, side, 'IC');
  const tos = eventsOf(events, side, 'TO');
  const oppTos = eventsOf(events, OPPOSITE[side], 'TO');
  const oppIcs = eventsOf(events, OPPOSITE[side], 'IC');

  const cycles = [];
  for (let i = 0; i + 1 < ics.length; i += 1) {
    const start = ics[i];
    const end = ics[i + 1];
    const toeOff = firstBetween(tos, start.sampleIndex, end.sampleIndex);
    const oppositeToeOff = firstBetween(oppTos, start.sampleIndex, end.sampleIndex);
    const oppositeIC = firstBetween(oppIcs, start.sampleIndex, end.sampleIndex);
    const stancePercent = percentInCycle(toeOff, start, end);
    cycles.push({
      side,
      number: i + 1,
      start,
      end,
      duration: end.motTime - start.motTime,
      toeOff,
      stancePercent,
      swingPercent: stancePercent === null ? null : 100 - stancePercent,
      oppositeToeOff,
      oppositeToeOffPercent: percentInCycle(oppositeToeOff, start, end),
      oppositeIC,
      oppositeICPercent: percentInCycle(oppositeIC, start, end),
    });
  }

  // 同側ICの記録漏れ（2歩行周期分を1周期とみなしている）の可能性を検出する
  if (cycles.length >= 2) {
    const durations = cycles.map((c) => c.duration).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    cycles.forEach((c) => {
      c.suspiciouslyLong = c.duration > median * 1.5;
    });
  }
  return cycles;
}
