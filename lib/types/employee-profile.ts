// EmployeeProfile DTO:服务端返回给前端的形状
// 日期/Decimal 字段已在前端可用的 ISO 字符串/number 类型
// PR3 起: address 拆 province/city/district/addressDetail;avatarAttachmentId 引用;
//         workExperience/educationHistory/certificates/emergencyContactName+Phone 全部迁出,改走子表

import type {
  EmployeeEducationDto,
  EmployeeWorkExperienceDto,
  EmployeeCertificateDto,
  EmployeeSkillDto,
  EmployeeEmergencyContactDto
} from "./employee-subtables";

export type ProfileAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type EmployeeProfileDto = {
  id: string;
  userId: string;
  gender: string | null;
  birthday: string | null;
  idCard: string | null;
  education: string | null;
  entryDate: string | null;
  // 住址(结构化)
  province: string | null;
  city: string | null;
  district: string | null;
  addressDetail: string | null;
  // 人事/岗位
  position: string | null;
  jobLevel: string | null;
  employmentType: string | null;
  probationEndDate: string | null;
  formalDate: string | null;
  resignationDate: string | null;
  // 合同
  contractType: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  // 头像
  avatarAttachmentId: string | null;
  // 敏感
  salary: number | null;
  bankAccount: string | null;
  bankName: string | null;
  socialSecurityAccount: string | null;
  providentFundAccount: string | null;
  // 备注
  remark: string | null;
  // 附件
  attachments: ProfileAttachment[];
  createdAt: string;
  updatedAt: string;
};

// 详情页/向导 一次拉全
export type FullEmployeeProfileDto = {
  profile: EmployeeProfileDto;
  educations: EmployeeEducationDto[];
  workExperiences: EmployeeWorkExperienceDto[];
  certificates: EmployeeCertificateDto[];
  skills: EmployeeSkillDto[];
  emergencyContacts: EmployeeEmergencyContactDto[];
  avatar: { id: string; name: string; mimeType: string; size: number } | null;
};
