"use client";
import { useParams } from "next/navigation";
import { useGoBack } from "@/lib/navigation";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Page } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { DetailPageSkeleton } from "@/components/detail-page-skeleton";
import { ErrorBox } from "@/components/callout";
import { ProfileWizard } from "@/components/employee-profile/profile-wizard";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

export default function EditProfilePage() {
  const params = useParams();
  const id = String(params.id);

  const goBack = useGoBack("/admin/users");
  const { data: session } = useSession();
  const roleCode = (session?.user as { roleCode?: string } | undefined)?.roleCode;
  const isAdmin = roleCode === "ADMIN";

  const { data, error, isLoading } = useSWR<{ data: FullEmployeeProfileDto | null }>(
    `/api/users/${id}/with-profile`
  );

  if (error) {
    return (
      <Page>
        <PageHeader back={goBack} title="编辑员工档案" />
        <ErrorBox title="加载失败">{(error as Error).message}</ErrorBox>
      </Page>
    );
  }
  if (isLoading || !data) {
    return (
      <Page>
        <PageHeader back={goBack} title="编辑员工档案" />
        <DetailPageSkeleton />
      </Page>
    );
  }
  if (!isAdmin) {
    return (
      <Page>
        <PageHeader back={goBack} title="编辑员工档案" />
        <ErrorBox title="无权限">仅管理员可编辑员工档案</ErrorBox>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        back={goBack}
        title="编辑员工档案"
        subtitle="5 步走完保存:基础 / 岗位合同 / 敏感 / 履历 / 证书与附件"
      />
      <ProfileWizard userId={id} initial={data.data} isAdmin={isAdmin} />
    </Page>
  );
}
