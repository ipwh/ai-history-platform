import Image from "next/image";

/** 校徽 + 校名品牌區（參考 AI English Platform 的 SchoolBrand） */
export const SCHOOL_NAME_ZH = "天主教普照中學";
export const SCHOOL_NAME_EN = "Po Chiu Catholic Secondary School";
export const SITE_NAME = "歷史科自學網站";

const LOGO_SRC = "/branding/pochiu-logo.png";
/** 校徽原始像素尺寸（95×126，直向） */
const LOGO_WIDTH = 95;
const LOGO_HEIGHT = 126;

const VARIANTS = {
  /** 登入頁：校徽置中 + 中英校名並列 */
  stacked: { plate: "p-2 rounded-2xl", img: "h-14" },
  /** 頁首／側欄：校徽 + 校名 */
  inline: { plate: "p-0.5 rounded-lg", img: "h-9" },
  /** 只顯示校徽 */
  icon: { plate: "p-0.5 rounded-lg", img: "h-9" },
} as const;

export interface SchoolBrandProps {
  variant?: keyof typeof VARIANTS;
  /** 顯示網站名稱（例如「歷史科自學網站」），僅 inline 使用 */
  showSiteName?: boolean;
  className?: string;
}

/**
 * 校徽一律置於白色圓角底板內：圖檔為白底不透明，
 * 置於底板可避免在不同背景色下出現方框邊緣。
 */
export function SchoolBrand({
  variant = "inline",
  showSiteName = false,
  className = "",
}: SchoolBrandProps) {
  const { plate, img } = VARIANTS[variant];

  const logo = (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 bg-white ring-1 ring-black/5 ${plate}`}
    >
      <Image
        src={LOGO_SRC}
        alt=""
        aria-hidden="true"
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        className={`${img} w-auto object-contain`}
        loading={variant === "stacked" ? "eager" : undefined}
        fetchPriority={variant === "stacked" ? "high" : undefined}
      />
    </span>
  );

  if (variant === "icon") {
    return (
      <span className={`inline-flex flex-shrink-0 ${className}`} role="img" aria-label={`${SCHOOL_NAME_ZH}校徽`}>
        {logo}
      </span>
    );
  }

  if (variant === "stacked") {
    return (
      <div className={`flex flex-col items-center gap-3 ${className}`}>
        {logo}
        <div className="text-center leading-tight">
          <p className="text-base font-bold">{SCHOOL_NAME_ZH}</p>
          <p className="mt-0.5 text-xs text-gray-500">{SCHOOL_NAME_EN}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2.5 min-w-0 ${className}`}>
      {logo}
      <div className="min-w-0 leading-tight">
        <p className="text-sm font-bold truncate">{SCHOOL_NAME_ZH}</p>
        {showSiteName ? (
          <p className="text-xs font-semibold truncate" style={{ color: "var(--accent)" }}>
            {SITE_NAME}
          </p>
        ) : (
          <p className="text-xs text-gray-500 truncate">{SCHOOL_NAME_EN}</p>
        )}
      </div>
    </div>
  );
}
