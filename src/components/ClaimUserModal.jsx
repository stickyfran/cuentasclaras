import React from 'react';
import { User, ShieldCheck } from 'lucide-react';

export default function ClaimUserModal({ members, groupId, claimedUserId, onClaimUser, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute -top-10 -left-10 w-40 h-40 bg-brand-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 bg-brand-500/20 text-brand-400 rounded-xl flex items-center justify-center mb-3">
            <User className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-bold text-slate-100">¿Quién eres?</h2>
          <p className="text-slate-400 text-sm mt-2">
            Selecciona tu perfil en este grupo para poder registrar o editar gastos a tu nombre.
          </p>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
          {members.map(member => {
            const isSelected = member.id === claimedUserId;
            return (
              <button
                key={member.id}
                onClick={() => {
                  onClaimUser(member.id);
                  if (onClose) onClose();
                }}
                className={`w-full flex items-center justify-between p-4 rounded-xl border text-left transition-all ${
                  isSelected
                    ? 'bg-brand-500/20 border-brand-500/50 text-brand-300'
                    : 'bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold ${
                    isSelected ? 'bg-brand-500 text-slate-950' : 'bg-slate-700 text-slate-200'
                  }`}>
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-semibold text-slate-200">{member.name}</span>
                </div>
                {isSelected && (
                  <ShieldCheck className="w-5 h-5 text-brand-400" />
                )}
              </button>
            );
          })}
        </div>

        {claimedUserId && (
          <button
            onClick={onClose}
            className="w-full mt-6 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl transition-all border border-slate-700"
          >
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
