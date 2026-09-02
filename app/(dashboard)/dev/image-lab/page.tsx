/**
 * TEMPORARY DIAGNOSTIC PAGE — safe to delete.
 * Remove this file and app/components/dev/ImageFlowLab.tsx; nothing else references them.
 */
import { AdminOnly } from "@/app/components/auth/AdminOnly";
import { PageHeader } from "@/app/components/layout/PageHeader";
import { ImageFlowLab } from "@/app/components/dev/ImageFlowLab";

export default function ImageLabPage() {
  return (
    <AdminOnly>
      <div className="space-y-6">
        <PageHeader
          title="Image flow lab"
          description="Pick a photo and this walks it through every stage of the real pipeline — browser compression, upload, what gets stored, what a page downloads, and what goes on the clipboard for WhatsApp — then prints a report you can copy."
        />
        <ImageFlowLab />
      </div>
    </AdminOnly>
  );
}
