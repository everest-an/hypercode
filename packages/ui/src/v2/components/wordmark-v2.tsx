import { type ComponentProps } from "solid-js"

// HyperCode wordmark: the <O> mark followed by the wordmark text. Uses
// currentColor so the consumer controls the colour (theme token) — nothing
// here pins a specific light/dark value.

// Mark geometry from brand/hypercode-mark.svg (25x25 grid, 10px cells).
function MarkPaths() {
  return (
    <>
      <rect x="60" y="70" width="20" height="10" />
      <rect x="50" y="80" width="20" height="10" />
      <rect x="40" y="90" width="20" height="10" />
      <rect x="30" y="100" width="20" height="10" />
      <rect x="20" y="110" width="20" height="10" />
      <rect x="10" y="120" width="20" height="10" />
      <rect x="20" y="130" width="20" height="10" />
      <rect x="30" y="140" width="20" height="10" />
      <rect x="40" y="150" width="20" height="10" />
      <rect x="50" y="160" width="20" height="10" />
      <rect x="60" y="170" width="20" height="10" />
      <rect x="120" y="90" width="10" height="10" />
      <rect x="120" y="100" width="10" height="10" />
      <rect x="120" y="140" width="10" height="10" />
      <rect x="120" y="150" width="10" height="10" />
      <rect x="110" y="100" width="10" height="10" />
      <rect x="110" y="110" width="10" height="10" />
      <rect x="110" y="130" width="10" height="10" />
      <rect x="110" y="140" width="10" height="10" />
      <rect x="130" y="100" width="10" height="10" />
      <rect x="130" y="110" width="10" height="10" />
      <rect x="130" y="130" width="10" height="10" />
      <rect x="130" y="140" width="10" height="10" />
      <rect x="100" y="110" width="10" height="10" />
      <rect x="100" y="120" width="10" height="10" />
      <rect x="100" y="130" width="10" height="10" />
      <rect x="140" y="110" width="10" height="10" />
      <rect x="140" y="120" width="10" height="10" />
      <rect x="140" y="130" width="10" height="10" />
      <rect x="90" y="120" width="10" height="10" />
      <rect x="150" y="120" width="10" height="10" />
      <rect x="170" y="70" width="20" height="10" />
      <rect x="180" y="80" width="20" height="10" />
      <rect x="190" y="90" width="20" height="10" />
      <rect x="200" y="100" width="20" height="10" />
      <rect x="210" y="110" width="20" height="10" />
      <rect x="220" y="120" width="20" height="10" />
      <rect x="210" y="130" width="20" height="10" />
      <rect x="200" y="140" width="20" height="10" />
      <rect x="190" y="150" width="20" height="10" />
      <rect x="180" y="160" width="20" height="10" />
      <rect x="170" y="170" width="20" height="10" />
    </>
  )
}

export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="currentColor"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      {/* mark: 250 grid scaled to 110px tall, vertically centred (129-110)/2 ≈ 9 */}
      <g transform="translate(10 9.5) scale(0.44)" shape-rendering="crispEdges" opacity="0.9">
        <MarkPaths />
      </g>
      {/* wordmark text, optically aligned with the mark cap height */}
      <text
        x="132"
        y="92"
        font-family="inherit"
        font-size="96"
        font-weight="700"
        letter-spacing="-3"
      >
        HyperCode
      </text>
    </svg>
  )
}
