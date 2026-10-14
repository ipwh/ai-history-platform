import { redirect } from "next/navigation";

/**
 * 相容舊路徑：題目管理屬教師端功能，已統一在 /teacher/questions。
 * 管理員同樣可以進入（教師端守衛允許管理員）。
 */
export default function AdminQuestionsRedirectPage() {
  redirect("/teacher/questions");
}
