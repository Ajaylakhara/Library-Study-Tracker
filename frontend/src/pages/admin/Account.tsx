import { useEffect, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ENDPOINTS } from '../../config/endpoints';
import { useAdminHeader } from '../../layout/AdminLayout';
import { get, patch, post, put } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { errMsg } from '../../toolkit/createAppThunk';
import { logout } from '../../toolkit/authThunks';
import { userUpdated } from '../../toolkit/authSlice';
import { showToast } from '../../toolkit/toastSlice';
import { brandingUpdated } from '../../toolkit/brandingSlice';
import { DEFAULT_BRANDING, type BrandingSettings } from '../../toolkit/brandingSlice';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface AdminBrandingSettings extends BrandingSettings {
  contactPhone: string;
}

const DEFAULT_ADMIN_BRANDING: AdminBrandingSettings = {
  ...DEFAULT_BRANDING,
  contactPhone: '',
};

async function resizeImage(source: Blob | string, maxDimension: number, maxBytes: number): Promise<{ dataUrl: string; size: number }> {
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();

    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not process this image.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.86, 0.75, 0.62, 0.5, 0.38]) {
      const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (!output) continue;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(output.type)) continue;
      if (output.size <= maxBytes) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Could not read the processed image.'));
          reader.readAsDataURL(output);
        });
        return { dataUrl: base64, size: output.size };
      }
    }

    throw new Error(`Image is still too large after resizing. Choose a simpler image under ${Math.round(maxBytes / 1024)} KB.`);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function brandingPayload(settings: AdminBrandingSettings): Record<string, unknown> {
  return {
    libraryName: settings.libraryName,
    shortName: settings.shortName,
    tagline: settings.tagline,
    logo: settings.logo,
    favicon: settings.favicon,
    contactPhone: settings.contactPhone,
  };
}

const fieldStyle = {
  width: '100%',
  minHeight: '46px',
  border: '1px solid rgba(3,39,85,0.16)',
  borderRadius: '12px',
  background: 'rgba(255,255,255,0.82)',
  padding: '0 14px',
  color: '#172B45',
  font: 'inherit',
  outlineColor: '#F8B345',
};

function isTrivialPin(pin: string, phone: string): boolean {
  return ['123456', '000000', '111111', '123123', phone.slice(-6)].includes(pin);
}

export function Component() {
  useAdminHeader('Account', 'Manage your sign-in details');
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [phonePin, setPhonePin] = useState('');
  const [phone, setPhone] = useState('');
  const [pinError, setPinError] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);

  const changePin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPinError('');
    if (newPin !== confirmPin) {
      setPinError('The new PIN and confirmation do not match.');
      return;
    }
    if (isTrivialPin(newPin, user?.phone ?? '')) {
      setPinError('Choose a PIN that is not easy to guess.');
      return;
    }

    setSavingPin(true);
    try {
      await post(ENDPOINTS.admin.changePin, { currentPin, newPin });
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      dispatch(showToast('success', 'PIN changed. Please sign in again.'));
      await dispatch(logout());
      navigate('/login', { replace: true });
    } catch (error) {
      setPinError(errMsg(error));
    } finally {
      setSavingPin(false);
    }
  };

  const changePhone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPhoneError('');
    setSavingPhone(true);
    try {
      const response = await post<{ phone: string }>(ENDPOINTS.admin.changePhone, {
        currentPin: phonePin,
        phone,
      });
      setPhonePin('');
      setPhone('');
      dispatch(userUpdated({ phone: response.data.phone }));
      dispatch(showToast('success', 'Phone number updated.'));
    } catch (error) {
      setPhoneError(errMsg(error));
    } finally {
      setSavingPhone(false);
    }
  };

  const pinInput = (label: string, value: string, onChange: (value: string) => void, id: string) => (
    <label htmlFor={id} style={{ display: 'grid', gap: '7px', color: '#3D4D63', fontWeight: 600 }}>
      {label}
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
        required
        style={fieldStyle}
      />
    </label>
  );

  return (
    <section style={{ display: 'grid', gap: '16px', maxWidth: '900px', animation: 'rise .35s both' }}>
      <div className="glass-c" style={{ borderRadius: '20px', padding: '24px' }}>
        <div style={{ marginBottom: '18px' }}>
          <h2 style={{ margin: 0, color: '#032755', fontSize: '20px' }}>Change PIN</h2>
          <p style={{ margin: '6px 0 0', color: '#5A6A7F' }}>Your PIN must be six digits and not easy to guess.</p>
        </div>
        <form onSubmit={changePin} style={{ display: 'grid', gap: '14px' }}>
          {pinInput('Current PIN', currentPin, setCurrentPin, 'current-pin')}
          {pinInput('New PIN', newPin, setNewPin, 'new-pin')}
          {pinInput('Confirm new PIN', confirmPin, setConfirmPin, 'confirm-pin')}
          {pinError && <p role="alert" style={{ margin: 0, color: '#A12F2F' }}>{pinError}</p>}
          <button type="submit" disabled={savingPin} style={buttonStyle}>
            {savingPin ? 'Updating...' : 'Change PIN'}
          </button>
        </form>
      </div>

      <div className="glass-c" style={{ borderRadius: '20px', padding: '24px' }}>
        <div style={{ marginBottom: '18px' }}>
          <h2 style={{ margin: 0, color: '#032755', fontSize: '20px' }}>Change phone number</h2>
          <p style={{ margin: '6px 0 0', color: '#5A6A7F' }}>
            Current phone: {user?.phone ? `+91 ${user.phone}` : 'Not available'}
          </p>
        </div>
        <form onSubmit={changePhone} style={{ display: 'grid', gap: '14px' }}>
          <label htmlFor="account-phone" style={{ display: 'grid', gap: '7px', color: '#3D4D63', fontWeight: 600 }}>
            New phone number
            <input
              id="account-phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              pattern="[0-9]{10}"
              maxLength={10}
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
              required
              style={fieldStyle}
            />
          </label>
          {pinInput('Current PIN', phonePin, setPhonePin, 'phone-current-pin')}
          {phoneError && <p role="alert" style={{ margin: 0, color: '#A12F2F' }}>{phoneError}</p>}
          <button type="submit" disabled={savingPhone} style={buttonStyle}>
            {savingPhone ? 'Updating...' : 'Change phone'}
          </button>
        </form>
      </div>
      <BrandingCard />
    </section>
  );
}

function BrandingCard() {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const branding = useAppSelector((state) => state.branding.settings);
  const logoPicker = useRef<HTMLInputElement>(null);
  const faviconPicker = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<AdminBrandingSettings>({
    ...DEFAULT_ADMIN_BRANDING,
    ...branding,
  });
  const [logoSize, setLogoSize] = useState(0);
  const [faviconSize, setFaviconSize] = useState(0);
  const [useLogoAsFavicon, setUseLogoAsFavicon] = useState(false);
  const [displayName, setDisplayName] = useState(user?.name ?? '');
  const [savingBranding, setSavingBranding] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmation, setConfirmation] = useState<'remove' | 'reset' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    get<AdminBrandingSettings>(ENDPOINTS.settings.admin)
      .then((response) => {
        if (active) {
          setSettings({ ...DEFAULT_ADMIN_BRANDING, ...response.data });
          setLogoSize(response.data.logo ? Math.ceil(response.data.logo.length * 0.75) : 0);
          setFaviconSize(response.data.favicon ? Math.ceil(response.data.favicon.length * 0.75) : 0);
        }
      })
      .catch((cause: unknown) => {
        if (active) dispatch(showToast('error', errMsg(cause)));
      });
    return () => { active = false; };
  }, [dispatch]);

  useEffect(() => {
    setDisplayName(user?.name ?? '');
  }, [user?.name]);

  const saved = (next: AdminBrandingSettings) => {
    setSettings(next);
    dispatch(brandingUpdated(next));
    setError('');
  };

  const saveBranding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingBranding(true);
    setError('');
    try {
      const response = await put<AdminBrandingSettings>(ENDPOINTS.settings.admin, brandingPayload(settings));
      saved(response.data);
      dispatch(showToast('success', 'Library branding saved.'));
    } catch (cause) {
      const message = errMsg(cause);
      setError(message);
      dispatch(showToast('error', message));
    } finally {
      setSavingBranding(false);
    }
  };

  const updateLogo = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      dispatch(showToast('error', 'Choose a PNG, JPEG, or WebP image.'));
      return;
    }
    try {
      const result = await resizeImage(file, 512, 300 * 1024);
      setLogoSize(result.size);
      setSettings((previous) => ({ ...previous, logo: result.dataUrl }));
      if (useLogoAsFavicon) {
        const favicon = await resizeImage(result.dataUrl, 64, 100 * 1024);
        setFaviconSize(favicon.size);
        setSettings((previous) => ({ ...previous, favicon: favicon.dataUrl }));
      }
      setError('');
    } catch (cause) {
      dispatch(showToast('error', errMsg(cause)));
    }
  };

  const updateFavicon = async (file?: File) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      dispatch(showToast('error', 'Choose a PNG, JPEG, or WebP image.'));
      return;
    }
    try {
      const result = await resizeImage(file, 64, 100 * 1024);
      setFaviconSize(result.size);
      setSettings((previous) => ({ ...previous, favicon: result.dataUrl }));
      setUseLogoAsFavicon(false);
      setError('');
    } catch (cause) {
      dispatch(showToast('error', errMsg(cause)));
    }
  };

  const toggleUseLogo = async (checked: boolean) => {
    setUseLogoAsFavicon(checked);
    if (!checked) return;
    if (!settings.logo) {
      dispatch(showToast('error', 'Upload a logo first.'));
      setUseLogoAsFavicon(false);
      return;
    }
    try {
      const result = await resizeImage(settings.logo, 64, 100 * 1024);
      setFaviconSize(result.size);
      setSettings((previous) => ({ ...previous, favicon: result.dataUrl }));
    } catch (cause) {
      dispatch(showToast('error', errMsg(cause)));
      setUseLogoAsFavicon(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void updateLogo(event.dataTransfer.files[0]);
  };

  const confirmAction = async () => {
    const action = confirmation;
    setConfirmation(null);
    if (!action) return;

    setSavingBranding(true);
    try {
      const response = action === 'reset'
        ? await put<AdminBrandingSettings>(ENDPOINTS.settings.admin, { ...DEFAULT_ADMIN_BRANDING })
        : await put<AdminBrandingSettings>(ENDPOINTS.settings.admin, {
            ...brandingPayload(settings),
            logo: null,
            ...(useLogoAsFavicon && { favicon: null }),
          });
      saved(response.data);
      setUseLogoAsFavicon(false);
      setLogoSize(response.data.logo ? Math.ceil(response.data.logo.length * 0.75) : 0);
      setFaviconSize(response.data.favicon ? Math.ceil(response.data.favicon.length * 0.75) : 0);
      dispatch(showToast('success', action === 'reset' ? 'Branding reset to defaults.' : 'Logo removed.'));
    } catch (cause) {
      const message = errMsg(cause);
      setError(message);
      dispatch(showToast('error', message));
    } finally {
      setSavingBranding(false);
    }
  };

  const saveDisplayName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingName(true);
    try {
      const response = await patch<{ displayName: string }>(ENDPOINTS.settings.adminProfile, { displayName });
      dispatch(userUpdated({ name: response.data.displayName }));
      dispatch(showToast('success', 'Admin display name updated.'));
    } catch (cause) {
      dispatch(showToast('error', errMsg(cause)));
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="glass-c" style={{ borderRadius: '20px', padding: '24px', display: 'grid', gap: '24px' }}>
      <div>
        <h2 style={{ margin: 0, color: '#032755', fontSize: '20px' }}>Library branding</h2>
        <p style={{ margin: '6px 0 0', color: '#5A6A7F' }}>Customize the name, logo, and contact details shown across the app.</p>
      </div>

      <form onSubmit={saveBranding} style={{ display: 'grid', gap: '14px' }}>
        <label style={fieldLabelStyle}>Library name
          <input required minLength={2} maxLength={60} value={settings.libraryName}
            onChange={(event) => setSettings({ ...settings, libraryName: event.target.value })} style={fieldStyle} />
        </label>
        <label style={fieldLabelStyle}>Short name
          <input required minLength={2} maxLength={60} value={settings.shortName}
            onChange={(event) => setSettings({ ...settings, shortName: event.target.value })} style={fieldStyle} />
        </label>
        <label style={fieldLabelStyle}>Tagline
          <input maxLength={120} value={settings.tagline}
            onChange={(event) => setSettings({ ...settings, tagline: event.target.value })} style={fieldStyle} />
        </label>
        <label style={fieldLabelStyle}>Contact phone
          <input type="tel" maxLength={20} value={settings.contactPhone}
            onChange={(event) => setSettings({ ...settings, contactPhone: event.target.value })} style={fieldStyle} />
        </label>

        <div>
          <div style={fieldLabelStyle}>Logo (maximum 512 × 512 pixels)</div>
          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => logoPicker.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') logoPicker.current?.click(); }}
            style={{
              minHeight: '130px', padding: '16px', borderRadius: '14px',
              border: `1px dashed ${dragging ? '#F8B345' : 'rgba(3,39,85,0.28)'}`,
              background: dragging ? 'rgba(248,179,69,0.10)' : 'rgba(255,255,255,0.55)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '18px',
              cursor: 'pointer', flexWrap: 'wrap',
            }}
          >
            {settings.logo ? <img src={settings.logo} alt="Logo preview" style={{ maxWidth: 180, maxHeight: 90, objectFit: 'contain' }} /> : <span style={{ color: '#5A6A7F' }}>Drop an image here or click to upload</span>}
            <span style={{ color: '#5A6A7F', fontSize: '12px' }}>
              {settings.logo ? `${Math.max(1, Math.round(logoSize / 1024))} KB processed` : 'PNG, JPEG, or WebP'}
            </span>
          </div>
          <input ref={logoPicker} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(event) => { void updateLogo(event.target.files?.[0]); event.target.value = ''; }} />
        </div>

        <div style={{ display: 'grid', gap: '10px' }}>
          <div style={fieldLabelStyle}>Favicon (maximum 64 × 64 pixels)</div>
          {settings.favicon && <img src={settings.favicon} alt="Favicon preview" style={{ width: 48, height: 48, objectFit: 'contain', border: '1px solid rgba(3,39,85,0.16)', borderRadius: 8 }} />}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#3D4D63' }}>
            <input type="checkbox" checked={useLogoAsFavicon} onChange={(event) => void toggleUseLogo(event.target.checked)} />
            Use my logo
          </label>
          {!useLogoAsFavicon && (
            <button type="button" onClick={() => faviconPicker.current?.click()} style={secondaryButtonStyle}>
              {settings.favicon ? 'Replace favicon' : 'Upload favicon'}
              {settings.favicon && ` · ${Math.max(1, Math.round(faviconSize / 1024))} KB`}
            </button>
          )}
          <input ref={faviconPicker} type="file" accept="image/png,image/jpeg,image/webp" hidden
            onChange={(event) => { void updateFavicon(event.target.files?.[0]); event.target.value = ''; }} />
        </div>

        {error && <p role="alert" style={{ margin: 0, color: '#A12F2F' }}>{error}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
          <button type="submit" disabled={savingBranding} style={buttonStyle}>{savingBranding ? 'Saving...' : 'Save branding'}</button>
          <button type="button" disabled={savingBranding || !settings.logo} onClick={() => setConfirmation('remove')} style={secondaryButtonStyle}>Remove logo</button>
          <button type="button" disabled={savingBranding} onClick={() => setConfirmation('reset')} style={secondaryButtonStyle}>Reset to defaults</button>
        </div>
      </form>

      <form onSubmit={saveDisplayName} style={{ display: 'grid', gap: '12px', borderTop: '1px solid rgba(3,39,85,0.1)', paddingTop: '20px' }}>
        <h3 style={{ margin: 0, color: '#032755', fontSize: '17px' }}>Admin display name</h3>
        <label style={fieldLabelStyle}>Name used in greetings and your profile card
          <input required minLength={2} maxLength={60} value={displayName}
            onChange={(event) => setDisplayName(event.target.value)} style={fieldStyle} />
        </label>
        <button type="submit" disabled={savingName} style={buttonStyle}>{savingName ? 'Saving...' : 'Save display name'}</button>
      </form>

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation === 'reset' ? 'Reset branding?' : 'Remove logo?'}
        description={confirmation === 'reset'
          ? 'This will restore the default library name and clear the custom logo and favicon.'
          : 'This will remove the saved logo. This action cannot be undone.'}
        confirmLabel={confirmation === 'reset' ? 'Reset defaults' : 'Remove logo'}
        tone="primary"
        loading={savingBranding}
        onCancel={() => setConfirmation(null)}
        onConfirm={confirmAction}
      />
    </div>
  );
}

const fieldLabelStyle = {
  display: 'grid',
  gap: '7px',
  color: '#3D4D63',
  fontSize: '13px',
  fontWeight: 600,
};

const secondaryButtonStyle = {
  minHeight: '40px',
  border: '1px solid rgba(3,39,85,0.16)',
  borderRadius: '10px',
  background: 'rgba(255,255,255,0.75)',
  color: '#24466C',
  padding: '0 12px',
  fontWeight: 600,
  cursor: 'pointer',
};

const buttonStyle = {
  minHeight: '46px',
  border: '1px solid rgba(3,39,85,0.12)',
  borderRadius: '12px',
  background: 'linear-gradient(135deg, #F8C96F, #F8B345)',
  color: '#032755',
  fontWeight: 700,
  fontSize: '14px',
  cursor: 'pointer',
};
