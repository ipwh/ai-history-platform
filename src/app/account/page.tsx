import { AccountView } from "@/components/AccountView";
import { guardStudentPage } from "@/server/auth/guards";

export const metadata = { title: "我的帳戶 ｜ 歷史科自學網站" };

/** 登入狀態、角色及登出 */
export default async function AccountPage() {
  await guardStudentPage("/account");
  return <AccountView />;
}
