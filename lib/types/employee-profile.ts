// EmployeeProfile DTO：服务端返回给前端的形状
// 日期/Decimal 字段已在前端可用的 ISO 字符串/number 类型

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
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  position: string | null;
  jobLevel: string | null;
  employmentType: string | null;
  probationEndDate: string | null;
  formalDate: string | null;
  resignationDate: string | null;
  contractType: string | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  salary: number | null;
  bankAccount: string | null;
  bankName: string | null;
  socialSecurityAccount: string | null;
  providentFundAccount: string | null;
  workExperience: string | null;
  educationHistory: string | null;
  certificates: string | null;
  remark: string | null;
  attachments: ProfileAttachment[];
  createdAt: string;
  updatedAt: string;
};
