type LogoProps = {
  className?: string
  title?: string
}

/** Notebook mark with filled cover and a heavy white K. */
export function KyokettiLogo({ className, title = 'Kyoketti' }: LogoProps) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* filled notebook body */}
      <rect x="14" y="10" width="36" height="44" rx="6" fill="currentColor" />
      {/* spiral binding */}
      <path
        d="M14 20h-5M14 29h-5M14 38h-5M14 47h-5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* heavy white K — filled geometric letterform */}
      <path
        fill="#fff"
        d="M24.5 18.5h7.2v10.1l9.4-10.1h8.6L37.2 32l12.7 13.5h-8.8l-9.4-10.2v10.2h-7.2V18.5z"
      />
    </svg>
  )
}
