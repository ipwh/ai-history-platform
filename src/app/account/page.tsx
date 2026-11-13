import { AccountView } from "@/components/AccountView";
import { SITE_NAME } from "@/lib/site";
import { guardStudentPage } from "@/server/auth/guards";

export const metadata = { title: `我的帳戶 ｜ ${SITE_NAME}` };

/** 登入狀態、角色及登出 */
export default async function AccountPage() {
  await guardStudentPage("/account");
  return <AccountView />;
}
