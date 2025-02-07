const nodemailer = require("nodemailer");
const handlebars = require("handlebars");
const {
  voteNotificationTemplate,
} = require("./templates/voteNotificationTemplate.js");

class EmailTransport {
  constructor() {
    const { SMTP_EMAIL, SMTP_PASSWORD } = process.env;

    this.transport = nodemailer.createTransport({
      host: "smtpout.secureserver.net",
      secure: true,
      port: 465,
      auth: {
        user: SMTP_EMAIL,
        pass: SMTP_PASSWORD,
      },
      tls: {
        ciphers: "SSLv3",
      },
    });

    this.SMTP_EMAIL = SMTP_EMAIL;
  }

  async verify() {
    try {
      await this.transport.verify();
      return true;
    } catch (error) {
      console.error("Email transport verification failed:", error);
      return false;
    }
  }

  async sendMail({ to, name, subject, body }) {
    try {
      const sendResult = await this.transport.sendMail({
        from: `${name} <${this.SMTP_EMAIL}>`,
        to,
        subject,
        html: body,
        headers: {
          "List-Unsubscribe": "",
        },
      });
      return sendResult;
    } catch (error) {
      console.error("Failed to send email:", error);
      throw error;
    }
  }
}

const emailTransport = new EmailTransport();

class EmailService {
  static proposalVoteTemplate(title, content, VoteContent, endContent) {
    try {
      const template = handlebars.compile(voteNotificationTemplate);
      return template({
        title,
        content,
        VoteContent,
        endContent,
      });
    } catch (error) {
      console.error("Failed to compile proposal vote template:", error);
      throw error;
    }
  }

  static async sendTemplatedEmail({
    to,
    name,
    subject,
    template,
    templateData,
  }) {
    try {
      // Verify connection
      const isVerified = await emailTransport.verify();
      if (!isVerified) {
        throw new Error("Failed to verify email transport connection");
      }
      // Compile template
      let htmlBody;
      if (template === "proposalVote") {
        const { title, content, VoteContent, endContent } = templateData;
        htmlBody = this.proposalVoteTemplate(
          title,
          content,
          VoteContent,
          endContent
        );
      } else {
        throw new Error(`Unknown template type: ${template}`);
      }

      // Send email
      return await emailTransport.sendMail({
        to,
        name: name || "System",
        subject,
        body: htmlBody,
      });
    } catch (error) {
      console.error("Failed to send templated email:", error);
      throw error;
    }
  }
}

module.exports = { EmailService };