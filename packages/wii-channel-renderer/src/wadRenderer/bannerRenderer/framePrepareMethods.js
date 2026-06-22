function getDevicePixelRatio(maxDevicePixelRatio) {
  const rawDpr = globalThis.devicePixelRatio || 1;
  const dpr = Math.max(1, rawDpr);
  return Math.min(dpr, maxDevicePixelRatio ?? Infinity);
}

export function getFrameMetrics(targetCanvas = this.canvas) {
  const layoutWidth = this.layout.width || targetCanvas?.clientWidth || targetCanvas?.width || 1;
  const layoutHeight = this.layout.height || targetCanvas?.clientHeight || targetCanvas?.height || 1;
  const referenceAspect = Number.isFinite(this.referenceAspectRatio) && this.referenceAspectRatio > 0
    ? this.referenceAspectRatio
    : 4 / 3;
  const displayAspect = Number.isFinite(this.displayAspectRatio) && this.displayAspectRatio > 0
    ? this.displayAspectRatio
    : null;
  const displayScaleX = displayAspect ? displayAspect / referenceAspect : 1;
  const outputWidth = layoutWidth * displayScaleX;
  const outputHeight = layoutHeight;
  const dpr = getDevicePixelRatio(this.maxDevicePixelRatio);
  const pixelWidth = Math.max(1, Math.round(outputWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(outputHeight * dpr));

  return {
    layoutWidth,
    layoutHeight,
    referenceAspect,
    displayAspect,
    displayScaleX,
    outputWidth,
    outputHeight,
    dpr,
    pixelWidth,
    pixelHeight,
    baseScaleX: dpr * displayScaleX,
    baseScaleY: dpr,
  };
}

export function resolvePreparedPane(pane, paneState, localPaneStates) {
  const transformChain = this.getPaneTransformChain(pane);
  let alpha = 1;
  let visible = true;
  let has3DRotation = false;
  const chainStates = [];

  for (const chainPane of transformChain) {
    const chainState = localPaneStates.get(chainPane);
    if (!chainState) {
      continue;
    }
    chainStates.push(chainState);
    if (chainPane !== pane && chainState.propagatesVisibility && chainState.visible === false) {
      visible = false;
    }
    if (chainState.influencedByParentAlpha) {
      alpha *= chainState.alpha;
    } else {
      alpha = chainState.alpha;
    }
    if (chainState.rotX !== 0 || chainState.rotY !== 0) {
      has3DRotation = true;
    }
  }

  const width = Number.isFinite(paneState?.width) ? paneState.width : 0;
  const height = Number.isFinite(paneState?.height) ? paneState.height : 0;
  const originOffset = this.getPaneOriginOffset(pane, width, height);
  const drawable =
    Boolean(paneState) &&
    visible &&
    alpha > 0 &&
    Math.abs(width) > 1e-6 &&
    Math.abs(height) > 1e-6;

  return {
    pane,
    paneState,
    transformChain,
    chainStates,
    originOffset,
    alpha,
    visible,
    has3DRotation,
    drawable,
  };
}

export function prepareFrame(frame, targetCanvas = this.canvas) {
  this.textureSrtAnimationCache.clear();

  const metrics = this.getFrameMetrics(targetCanvas);
  const localPaneStates = this.localPaneStates;
  localPaneStates.clear();
  for (const pane of this.allPanes) {
    localPaneStates.set(pane, this.getLocalPaneState(pane, frame));
  }

  const orderedRenderablePanes = this.activeRenderablePanes ?? this.renderablePanes;
  const preparedPanes = [];
  for (const pane of orderedRenderablePanes) {
    const paneState = localPaneStates.get(pane);
    if (!paneState) {
      continue;
    }
    preparedPanes.push(this.resolvePreparedPane(pane, paneState, localPaneStates));
  }

  const prepared = {
    frame,
    metrics,
    localPaneStates,
    orderedRenderablePanes,
    preparedPanes,
  };
  this.preparedFrame = prepared;
  return prepared;
}
