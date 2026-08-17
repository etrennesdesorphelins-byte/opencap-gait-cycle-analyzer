export function createICState() {
  return {
    first: { sampleIndex: null, motTime: null, videoTime: null },
    second: { sampleIndex: null, motTime: null, videoTime: null },
  };
}

export function setIC(icState, which, { sampleIndex, motTime, videoTime }) {
  icState[which] = { sampleIndex, motTime, videoTime };
  return icState;
}

export function resetIC(icState) {
  icState.first = { sampleIndex: null, motTime: null, videoTime: null };
  icState.second = { sampleIndex: null, motTime: null, videoTime: null };
  return icState;
}

export function isICValid(icState) {
  return (
    icState.first.sampleIndex !== null &&
    icState.second.sampleIndex !== null &&
    icState.second.sampleIndex > icState.first.sampleIndex
  );
}

export function gaitCycleDuration(icState) {
  if (!isICValid(icState)) return null;
  return icState.second.motTime - icState.first.motTime;
}
