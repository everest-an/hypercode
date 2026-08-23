import { type ComponentProps } from "solid-js"

// HyperCode mark: < O > — bold chevrons around a porthole on a 25x25 grid
// (10px cells), sourced from brand/hypercode-mark.svg. Monochrome; inherits
// the app icon color through --icon-base.
function MarkPaths() {
  return (
    <>
      {/* left chevron < */}
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
      {/* circular porthole O */}
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
      {/* right chevron > */}
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

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 250 250"
      fill="var(--icon-base)"
      shape-rendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <MarkPaths />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 250 250"
      fill="var(--icon-base)"
      shape-rendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <MarkPaths />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 250 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g transform="translate(2 3) scale(0.144)" fill="var(--icon-base)" shape-rendering="crispEdges">
        <MarkPaths />
      </g>
      <text
        x="46"
        y="29.5"
        fill="var(--icon-base)"
        font-size="24"
        font-weight="700"
        letter-spacing="-0.5"
      >
        HyperCode
      </text>
    </svg>
  )
}
