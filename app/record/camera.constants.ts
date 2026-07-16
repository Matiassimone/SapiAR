// 30 on purpose, not a placeholder. 60fps intermittently loses
// frame-timestamp delivery mid-recording under multi-cam load (checkpoint
// 10 outdoor finding). 30 proved stable in every test.
export const DEFAULT_FPS = 30
