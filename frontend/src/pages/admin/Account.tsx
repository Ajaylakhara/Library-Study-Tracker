import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ENDPOINTS } from '../../config/endpoints';
import { useAdminHeader } from '../../layout/AdminLayout';
import { post } from '../../store/api';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { errMsg } from '../../toolkit/createAppThunk';
import { logout } from '../../toolkit/authThunks';
import { userUpdated } from '../../toolkit/authSlice';
import { showToast } from '../../toolkit/toastSlice';

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
    </section>
  );
}

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
