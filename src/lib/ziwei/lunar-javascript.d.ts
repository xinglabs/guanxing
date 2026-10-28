declare module 'lunar-javascript' {
  class Lunar {
    /** month 为负表示闰月（如 -5 = 闰五月） */
    static fromYmd(year: number, month: number, day: number): Lunar;
    getYear(): number;
    getMonth(): number;  // negative = leap month
    getDay(): number;
    getYearGan(): string;
    getYearZhi(): string;
    getMonthGan(): string;
    getMonthZhi(): string;
    getDayGan(): string;
    getDayZhi(): string;
    /** 换算成公历(2026-08-05 补声明:lib/ziwei/share.ts 早在用，只是从前靠 as any 绕过) */
    getSolar(): Solar;
  }

  class Solar {
    static fromYmd(year: number, month: number, day: number): Solar;
    getLunar(): Lunar;
    getYear(): number;
    getMonth(): number;
    getDay(): number;
  }

  /** 农历月信息(2026-06-10 补:闰月大小月边界 clamp 用) */
  class LunarMonth {
    /** month 为负表示闰月(如 -5 = 闰五月);查无此月返回 null */
    static fromYm(year: number, month: number): LunarMonth | null;
    getDayCount(): number;
  }
}
