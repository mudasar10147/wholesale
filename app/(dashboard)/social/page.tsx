import { SocialOnly } from "@/app/components/auth/SocialOnly";
import { SocialPlannerPage } from "@/app/components/social/SocialPlannerPage";

export default function SocialPage() {
  return (
    <SocialOnly>
      <SocialPlannerPage />
    </SocialOnly>
  );
}
