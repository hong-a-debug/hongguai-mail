import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Turnstile } from "@marsidev/react-turnstile";
import { useTranslation } from "react-i18next";
import Cookies from "js-cookie";
import { Link } from "react-router-dom";
import { toast } from "react-hot-toast";

import { MailList } from "../components/MailList.tsx";
import { CopyButton } from "../components/CopyButton.tsx";
import {
  getEmails,
  getMailboxMeta,
  deleteEmails,
  loginByPassword,
  refreshMailboxToken,
  verifyTurnstile,
} from "../services/api.ts";
import { useConfig } from "../hooks/useConfig.ts";
import { encrypt } from "../lib/utlis.ts";

import { usePasswordModal } from "../components/password.tsx";
import PasswordIcon from "../components/icons/Password.tsx";
import Close from "../components/icons/Close.tsx";

import type { Email } from "../database_types.ts";
import { InfoModal } from "../components/InfoModal.tsx";
import { MailDetail } from "./MailDetail.tsx";
import { CountdownTimer } from "../components/CountdownTimer.tsx";
import { useSenderModal } from "../components/sender.tsx";

const VALIDITY_OPTIONS = [
  { label: "1 hour", value: 1 * 60 * 60 * 1000 },
  { label: "6 hours", value: 6 * 60 * 60 * 1000 },
  { label: "24 hours", value: 24 * 60 * 60 * 1000 },
  { label: "7 days", value: 7 * 24 * 60 * 60 * 1000 },
];

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="glass-card-hover p-4 group">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="font-semibold text-white text-sm mb-1 group-hover:text-cyan-400 transition-colors">
        {title}
      </div>
      <div className="text-xs text-slate-400">{desc}</div>
    </div>
  );
}

export function Home() {
  const config = useConfig();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // ========== 固定共享邮箱 ==========
  const FIXED_EMAIL = "public@hg-chat.win";

  const [address, setAddress] = useState<string | undefined>(() => {
    const cookieAddr = Cookies.get("userMailbox");
    if (cookieAddr) return cookieAddr;
    Cookies.set("userMailbox", FIXED_EMAIL, { expires: 365 });
    return FIXED_EMAIL;
  });

  const [mailboxToken, setMailboxToken] = useState<string>(
    () => Cookies.get("mailboxToken") || "",
  );
  const [expiryTimestamp, setExpiryTimestamp] = useState<number | undefined>(
    () => {
      const expiry = Cookies.get("emailExpiry");
      return expiry ? parseInt(expiry, 10) : undefined;
    },
  );
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string>(
    config.emailDomain[0],
  );
  const [validityMs, setValidityMs] = useState<number>(7 * 24 * 60 * 60 * 1000);
  const [notificationEnabled, setNotificationEnabled] = useState<boolean>(false);
  const [mailboxNote, setMailboxNote] = useState<string>("");
  const [isEditingNote, setIsEditingNote] = useState<boolean>(false);
  const [noteInput, setNoteInput] = useState<string>("");
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [hasReceivedEmail, setHasReceivedEmail] = useState(false);

  const { PasswordModal, setShowPasswordModal } = usePasswordModal();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const { SenderModal, setShowSenderModal } = useSenderModal(
    address || "",
    mailboxToken,
  );
  const canSendEmails = Boolean(address && mailboxToken && config.sendChannel);

  const {
    data: emails = [],
    isLoading,
    isFetching,
    refetch,
    error: emailsError,
  } = useQuery<Email[], Error>({
    queryKey: ["emails", address],
    queryFn: () => getEmails(address!, 50),
    enabled: !!address,
    refetchInterval: false,
    retry: false,
  });

  useEffect(() => {
    if (emailsError) {
      toast.error(`${t("Failed to get emails")}: ${emailsError.message}`, {
        duration: 5000,
      });
    }
  }, [emailsError, t]);

  const mailboxMetaSignatureRef = useRef<string | null>(null);

  const { data: mailboxMeta } = useQuery({
    queryKey: ["emails-meta", address],
    queryFn: () => getMailboxMeta(address!),
    enabled: !!address,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 10000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  useEffect(() => {
    if (!mailboxMeta) {
      return;
    }

    const signature = `${mailboxMeta.count}:${mailboxMeta.latestEmailCreatedAt ?? ""}`;
    if (mailboxMetaSignatureRef.current === null) {
      mailboxMetaSignatureRef.current = signature;
      return;
    }

    if (mailboxMetaSignatureRef.current !== signature) {
      mailboxMetaSignatureRef.current = signature;
      queryClient.invalidateQueries({ queryKey: ["emails", address] });
    }
  }, [address, mailboxMeta, queryClient]);

  const showPasswordToast = useCallback(
    (password: string) => {
      toast(
        (toastInstance) => (
          <div className="w-full max-w-lg glass-card p-4 text-white">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-700/50">
              <div className="flex items-center gap-2">
                <PasswordIcon className="h-5 w-5 text-cyan-400" />
                <h3 className="font-semibold">{t("View password")}</h3>
              </div>
              <button
                onClick={() => toast.dismiss(toastInstance.id)}
                className="p-1 rounded-full text-gray-400 hover:bg-slate-700 hover:text-white transition-colors"
                aria-label="Close">
                <Close className="h-4 w-4" />
              </button>
            </div>
            <div>
              <p className="text-sm text-gray-400 mb-2">
                {t("Save your password and continue using this email in 1 day")}
              </p>
              <div className="flex items-center text-sm bg-slate-800/50 px-3 py-2 rounded-lg border border-slate-700/50">
                <span className="flex-1 font-mono break-all text-cyan-300">
                  {password}
                </span>
                <CopyButton text={password} className="p-1" />
              </div>
              <p className="mt-2 text-xs text-amber-400">
                {t("Remember your password, otherwise your email will expire and cannot be retrieved")}
              </p>
            </div>
          </div>
        ),
        {
          id: "password-notification",
          duration: 8000,
          position: "top-center",
          style: {
            background: "transparent",
            border: "none",
            padding: 0,
            boxShadow: "none",
          },
        },
      );
    },
    [t],
  );

  useEffect(() => {
    if (!showPromoModal) {
      localStorage.setItem("cunmail_promo_shown", "true");
    }
  }, [showPromoModal]);

  const prevEmailsLength = useRef(emails.length);
  useEffect(() => {
    if (emails.length > 0 && !hasReceivedEmail) {
      setHasReceivedEmail(true);
    }

    if (!address) {
      setHasReceivedEmail(false);
      setExpiryTimestamp(undefined);
      toast.dismiss("password-notification");
    } else {
      const expiry = Cookies.get("emailExpiry");
      if (expiry && !expiryTimestamp) {
        setExpiryTimestamp(parseInt(expiry, 10));
      }
    }

    prevEmailsLength.current = emails.length;
  }, [emails, address, hasReceivedEmail, expiryTimestamp]);

  // ========== 禁用生成邮箱，使用固定邮箱 ==========
  const handleCreateAddress = async () => {
    toast.error("此邮箱为固定共享邮箱，无需创建");
    return;
  };

  const handleStopAddress = () => {
    toast.error("此邮箱为固定共享邮箱，不可销毁");
    return;
  };

  const handleRefresh = () => {
    refetch();
    toast.success(t("Mailbox refreshed"));
  };

  const handleResetExpiry = useCallback(async () => {
    if (mailboxToken) {
      try {
        const refreshedToken = await refreshMailboxToken(mailboxToken);
        const newExpiry = Date.now() + validityMs;
        const cookieExpires = new Date(newExpiry);
        Cookies.set("mailboxToken", refreshedToken, { expires: cookieExpires });
        setMailboxToken(refreshedToken);
      } catch {
        toast.error(t("SEND_UNAUTHORIZED"));
        return;
      }
    }

    const newExpiry = Date.now() + validityMs;
    const cookieExpires = new Date(newExpiry);

    Cookies.set("emailExpiry", newExpiry.toString(), {
      expires: cookieExpires,
    });
    Cookies.set("userMailbox", address!, { expires: cookieExpires });
    setExpiryTimestamp(newExpiry);
    toast.success(t("Validity reset successfully"));
  }, [mailboxToken, validityMs, address, t]);

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => deleteEmails(ids),
    onSuccess: () => {
      toast.success(t("Emails deleted successfully"));
      setSelectedIds([]);
      if (selectedEmail && selectedIds.includes(selectedEmail.id)) {
        setSelectedEmail(null);
      }
      queryClient.invalidateQueries({ queryKey: ["emails", address] });
    },
    onError: () => {
      toast.error(t("Failed to delete emails"));
    },
  });

  const handleDeleteEmails = (ids: string[]) => {
    if (ids.length === 0) {
      toast.error(t("Please select emails to delete"));
      return;
    }
    deleteMutation.mutate(ids);
  };

  const handleLogin = async (password: string) => {
    setIsLoggingIn(true);
    try {
      const data = await loginByPassword(password);
      const now = Date.now();
      const expires = now + validityMs;
      const cookieExpires = new Date(expires);
      Cookies.set("userMailbox", data.address, { expires: cookieExpires });
      Cookies.set("emailExpiry", expires.toString(), { expires: cookieExpires });
      if (data.mailboxToken) {
        Cookies.set("mailboxToken", data.mailboxToken, { expires: cookieExpires });
      } else {
        Cookies.remove("mailboxToken");
      }
      setAddress(data.address);
      setMailboxToken(data.mailboxToken || "");
      setExpiryTimestamp(expires);
      setShowPasswordModal(false);
      toast.success(t("Login successful"));
    } catch (error: any) {
      toast.error(`${t("Login failed")}: ${t(error.message)}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      toast.error("浏览器不支持桌面通知");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotificationEnabled(true);
      toast.success(t("Notification enabled"));
    } else {
      toast.error("通知权限被拒绝");
    }
  }, [t]);

  const sendNotification = useCallback((email: Email) => {
    if (!notificationEnabled || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const fromName = email.from?.name || email.messageFrom || "未知发件人";
    const subject = email.subject || "(无主题)";

    try {
      new Notification(t("New email arrived"), {
        body: `${t("From")}: ${fromName}\n${t("Subject")}: ${subject}`,
        icon: "/favicon.ico",
      });
    } catch (e) {
      console.error("Failed to send notification:", e);
    }
  }, [notificationEnabled, t]);

  const prevEmailsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!notificationEnabled) {
      prevEmailsRef.current = emails.map(e => e.id);
      return;
    }

    const currentIds = emails.map(e => e.id);
    const prevIds = prevEmailsRef.current;
    
    if (prevIds.length > 0) {
      const newEmails = emails.filter(e => !prevIds.includes(e.id));
      if (newEmails.length > 0) {
        sendNotification(newEmails[0]);
      }
    }
    
    prevEmailsRef.current = currentIds;
  }, [emails, notificationEnabled, sendNotification]);

  useEffect(() => {
    if (address) {
      const savedNote = localStorage.getItem(`cunmail_note_${address}`);
      if (savedNote) {
        setMailboxNote(savedNote);
      } else {
        setMailboxNote("");
      }
    }
  }, [address]);

  const handleSaveNote = () => {
    if (address) {
      localStorage.setItem(`cunmail_note_${address}`, noteInput);
      setMailboxNote(noteInput);
      setIsEditingNote(false);
      toast.success("备注已保存");
    }
  };

  const handleStartEditNote = () => {
    setNoteInput(mailboxNote);
    setIsEditingNote(true);
  };

  const getPassword = useCallback(() => {
    if (address && config.cookiesSecret) {
      return encrypt(address, config.cookiesSecret);
    }
    return null;
  }, [address, config.cookiesSecret]);

  const handleSelectEmail = (email: Email) => {
    setSelectedEmail(email);
  };

  const handleCloseDetail = () => {
    setSelectedEmail(null);
  };

  const handleExpandEmail = () => {
    setShowEmailModal(true);
  };

  return (
    <div className="pt-24 pb-12 px-4 md:px-8 lg:px-12 max-w-[1600px] mx-auto">
      <PasswordModal onLogin={handleLogin} isLoggingIn={isLoggingIn} />
      <SenderModal />

      {selectedEmail && (
        <InfoModal
          showModal={showEmailModal}
          setShowModal={setShowEmailModal}
          title={t("Email Detail")}>
          <MailDetail
            email={selectedEmail}
            onClose={() => setShowEmailModal(false)}
          />
        </InfoModal>
      )}

      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-[440px] shrink-0 space-y-4">
          <div className="glass-card p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-cyan-500/20 to-transparent rounded-full blur-2xl" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <div className="glow-dot" />
                <span className="text-xs text-cyan-400 font-medium">ONLINE</span>
              </div>
              <h1 className="text-2xl font-bold mb-1">
                <span className="gradient-text">红怪邮箱</span>
              </h1>
              <p className="text-sm text-slate-400 mb-4">
                {t("Privacy friendly")}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-cyan-400">7d</div>
                  <div className="text-[10px] text-slate-500">有效期</div>
                </div>
                <div className="bg-slate-800/50 rounded-lg p-3 text-center">
                  <div className="text-lg font-bold text-purple-400">∞</div>
                  <div className="text-[10px] text-slate-500">邮箱数量</div>
                </div>
              </div>
            </div>
          </div>

          {/* ========== 固定邮箱地址展示 ========== */}
          <div className="glass-card p-5 space-y-4">
            <div>
              <div className="text-xs text-slate-400 mb-2 font-medium">
                📧 公共共享邮箱
              </div>
              <div className="flex items-center bg-slate-800/50 border border-cyan-500/30 rounded-lg px-3 py-3">
                <span className="truncate font-mono text-sm text-cyan-300 flex-1">
                  {address || FIXED_EMAIL}
                </span>
                <CopyButton text={address || FIXED_EMAIL} className="p-1.5" />
              </div>
              <p className="text-xs text-slate-500 mt-2 text-center">
                💡 所有人共享此邮箱，收到的邮件都会显示在这里
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-400 font-medium">邮箱备注</span>
                {!isEditingNote && (
                  <button
                    onClick={handleStartEditNote}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                    {mailboxNote ? "编辑" : "添加备注"}
                  </button>
                )}
              </div>
              {isEditingNote ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="比如：注册某网站用"
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-white text-sm focus:outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20 transition-all"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveNote();
                    }}
                  />
                  <button
                    onClick={handleSaveNote}
                    className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-medium hover:shadow-lg hover:shadow-cyan-500/30 transition-all">
                    保存
                  </button>
                  <button
                    onClick={() => setIsEditingNote(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800/50 border border-slate-700/50 text-slate-400 text-xs font-medium hover:border-slate-600 transition-all">
                    取消
                  </button>
                </div>
              ) : (
                <div className="px-3 py-2.5 rounded-lg bg-slate-800/30 border border-slate-700/30">
                  {mailboxNote ? (
                    <span className="text-sm text-yellow-400/80">📝 {mailboxNote}</span>
                  ) : (
                    <span className="text-sm text-slate-500 italic">暂无备注，点击上方添加备注</span>
                  )}
                </div>
              )}
            </div>

            {expiryTimestamp && (
              <CountdownTimer
                expiryTimestamp={expiryTimestamp}
                onReset={handleResetExpiry}
              />
            )}

            <button
              onClick={requestNotificationPermission}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                notificationEnabled
                  ? "bg-green-500/10 border border-green-500/30 text-green-400"
                  : "bg-slate-800/50 border border-slate-700/50 text-slate-400 hover:border-cyan-500/30 hover:text-cyan-400"
              }`}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              {notificationEnabled ? t("Notification enabled") : t("Enable notification")}
            </button>

            <div className="flex gap-2">
              <button
                onClick={handleStopAddress}
                className="flex-1 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-all cursor-not-allowed opacity-50">
                销毁邮箱（已禁用）
              </button>
              {canSendEmails && (
                <button
                  onClick={() => setShowSenderModal(true)}
                  className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-medium hover:shadow-lg hover:shadow-cyan-500/30 transition-all">
                  {t("Send email")}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FeatureCard
              icon="🔒"
              title="隐私保护"
              desc="不用注册，用完即焚"
            />
            <FeatureCard
              icon="⚡"
              title="即时接收"
              desc="秒级送达，实时刷新"
            />
            <FeatureCard
              icon="🌐"
              title="多域名"
              desc="自定义邮箱后缀"
            />
            <FeatureCard
              icon="📨"
              title="支持发信"
              desc="匿名发送邮件"
            />
          </div>

          <div className="glass-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-sm font-medium text-white">快速开始</span>
            </div>
            <ol className="space-y-2 text-xs text-slate-400">
              <li className="flex gap-2">
                <span className="text-cyan-400 font-bold">1.</span>
                <span>复制上面的邮箱地址</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-bold">2.</span>
                <span>去注册网站填写此邮箱</span>
              </li>
              <li className="flex gap-2">
                <span className="text-cyan-400 font-bold">3.</span>
                <span>回到这里查看验证码邮件</span>
              </li>
            </ol>
          </div>

          {/* ========== 红怪社区 ========== */}
          <div className="glass-card p-4 bg-gradient-to-br from-cyan-500/5 to-purple-500/5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🚀</span>
              <span className="text-sm font-medium text-white">红怪社区</span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              欢迎来到红怪社区，我们致力于提供最好的互联网工具和服务。
            </p>
            <div className="grid grid-cols-3 gap-2">
              <a
                href="https://link.hg-chat.win/bilibili"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 p-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-pink-500/30 transition-all group">
                <svg className="w-4 h-4 text-slate-400 group-hover:text-pink-400 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/>
                </svg>
                <span className="text-[10px] text-slate-400 group-hover:text-pink-400 transition-colors">B站</span>
              </a>
              <a
                href="https://link.hg-chat.win/youtube"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 p-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-red-500/30 transition-all group">
                <svg className="w-4 h-4 text-slate-400 group-hover:text-red-400 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                <span className="text-[10px] text-slate-400 group-hover:text-red-400 transition-colors">油管</span>
              </a>
              <a
                href="https://link.hg-chat.win/discord"
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1 p-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 hover:border-indigo-500/30 transition-all group">
                <svg className="w-4 h-4 text-slate-400 group-hover:text-indigo-400 transition-colors" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                </svg>
                <span className="text-[10px] text-slate-400 group-hover:text-indigo-400 transition-colors">Discord</span>
              </a>
            </div>
          </div>
          {/* ========== 红怪社区结束 ========== */}
        </div>

        <div className="flex-1 min-w-0">
          <MailList
            isAddressCreated={!!address}
            emails={emails}
            isLoading={isLoading}
            isFetching={isFetching}
            onDelete={handleDeleteEmails}
            isDeleting={deleteMutation.isPending}
            onRefresh={handleRefresh}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onSelectEmail={handleSelectEmail}
            showViewPasswordButton={hasReceivedEmail}
            onShowPassword={() => {
              const password = getPassword();
              if (password) {
                showPasswordToast(password);
              }
            }}
            selectedEmail={selectedEmail}
            onCloseDetail={handleCloseDetail}
            onExpand={handleExpandEmail}
            canSendEmails={canSendEmails}
            onOpenSender={() => setShowSenderModal(true)}
          />
        </div>
      </div>
    </div>
  );
}