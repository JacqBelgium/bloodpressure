import { SendMailClient } from "zeptomail";

export type SendEmailInput = {
  to: { email: string; name: string };
  subject: string;
  htmlBody: string;
};

export async function sendEmail({ to, subject, htmlBody }: SendEmailInput) {
  const client = new SendMailClient({
    url: "https://api.zeptomail.com/v1.1/email",
    token: process.env.ZEPTOMAIL_API_KEY!,
  });

  return client.sendMail({
    from: {
      address: process.env.ZEPTOMAIL_FROM_EMAIL!,
      name: "StaticIso",
    },
    to: [
      {
        email_address: {
          address: to.email,
          name: to.name,
        },
      },
    ],
    subject,
    htmlbody: htmlBody,
  });
}
