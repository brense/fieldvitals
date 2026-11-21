/**
 * Everything is prefixed with `fv-` and takes its text colour and font from the page. Colours
 * can be set from outside with `--fv-good`, `--fv-needs-improvement`, `--fv-poor`, `--fv-line`
 * and `--fv-muted`.
 */
export const STYLES = `
.fv{font-variant-numeric:tabular-nums;line-height:1.4}
.fv *{box-sizing:border-box}
.fv-title{margin:0;font-size:1.5em}
.fv-sub{margin:.25em 0 0;color:var(--fv-muted,color-mix(in srgb,currentColor 68%,transparent))}
.fv-filters{display:flex;flex-wrap:wrap;gap:.75em 1.5em;margin:1.25em 0}
.fv-group{display:flex;flex-wrap:wrap;align-items:center;gap:.35em;margin:0;padding:0;list-style:none}
.fv-label{margin-right:.25em;font-weight:600}
.fv-choice{display:inline-block;padding:.2em .7em;border:1px solid var(--fv-line,color-mix(in srgb,currentColor 22%,transparent));border-radius:999px;color:inherit;text-decoration:none}
.fv-choice:hover{border-color:currentColor}
.fv-choice[aria-current]{border-color:currentColor;background:color-mix(in srgb,currentColor 10%,transparent);font-weight:600}
.fv-route{margin:0 0 1.25em}
.fv-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(13em,1fr));gap:1em;margin:0;padding:0;list-style:none}
.fv-card{padding:1em;border:1px solid var(--fv-line,color-mix(in srgb,currentColor 22%,transparent));border-radius:.6em}
.fv-metric{margin:0;font-size:1em;font-weight:600}
.fv-full{display:block;font-weight:400;font-size:.85em;color:var(--fv-muted,color-mix(in srgb,currentColor 68%,transparent))}
.fv-value{margin:.4em 0 0;font-size:1.9em;font-weight:600;line-height:1.1}
.fv-rating{display:flex;align-items:center;gap:.4em;margin:.2em 0 0;font-weight:600}
.fv-dot{display:inline-block;flex:none;width:.7em;height:.7em;border-radius:50%;background:var(--fv-muted,color-mix(in srgb,currentColor 40%,transparent))}
.fv-good .fv-dot,.fv-bar .fv-good{background:var(--fv-good,#0a7c35)}
.fv-needs-improvement .fv-dot,.fv-bar .fv-needs-improvement{background:var(--fv-needs-improvement,#b45f06)}
.fv-poor .fv-dot,.fv-bar .fv-poor{background:var(--fv-poor,#c5221f)}
.fv-needs-improvement .fv-dot{border-radius:.15em}
.fv-poor .fv-dot{border-radius:0;transform:rotate(45deg) scale(.85)}
.fv-bar{display:flex;gap:2px;height:.5em;margin:.9em 0 .3em;border-radius:.25em;overflow:hidden;background:var(--fv-line,color-mix(in srgb,currentColor 22%,transparent))}
.fv-bar span{display:block;min-width:0}
.fv-small{margin:0;font-size:.85em;color:var(--fv-muted,color-mix(in srgb,currentColor 68%,transparent))}
.fv-spark{display:block;width:100%;height:2.5em;margin:.8em 0 .3em;overflow:visible}
.fv-spark path{fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke}
.fv-spark line{stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
.fv-spark .fv-good{stroke:var(--fv-good,#0a7c35)}
.fv-spark .fv-poor{stroke:var(--fv-poor,#c5221f)}
.fv-few{display:inline-block;margin-left:.4em;padding:0 .45em;border:1px solid currentColor;border-radius:.3em;font-size:.9em}
.fv-heading{margin:2em 0 .5em;font-size:1.15em}
.fv-scroll{overflow-x:auto}
.fv-table{width:100%;border-collapse:collapse;text-align:left}
.fv-table th,.fv-table td{padding:.5em .75em .5em 0;border-bottom:1px solid var(--fv-line,color-mix(in srgb,currentColor 22%,transparent));white-space:nowrap;vertical-align:baseline}
.fv-table th{font-size:.85em}
.fv-table .fv-num{text-align:right}
.fv-table code{font-size:.95em;white-space:normal;overflow-wrap:anywhere}
.fv-table a{color:inherit}
.fv-table tr[aria-current] td:first-child{font-weight:600}
.fv-cell{display:inline-flex;align-items:center;gap:.4em}
.fv-unsure{opacity:.6}
.fv-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.fv-note{margin:1.5em 0 0;max-width:60em;font-size:.85em;color:var(--fv-muted,color-mix(in srgb,currentColor 68%,transparent))}
`;
