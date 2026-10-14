import { HomeView } from "@/components/HomeView";
import { guardStudentPage } from "@/server/auth/guards";

export default async function HomePage() {
  await guardStudentPage("/");
  return <HomeView />;
}
