import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, ScanLine, X, Copy, Check, Camera, RefreshCw } from 'lucide-react';
import { generateQRString, importFromQRString } from '../hooks/useSync';

export default function QRShareModal({ groupId, onImportSuccess, onClose }) {
  const [qrString, setQrString] = useState('');
  const [copied, setCopied] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [cameraPermission, setCameraPermission] = useState(true);

  const html5QrcodeRef = useRef(null);
  const scannerId = 'qr-camera-scanner';

  useEffect(() => {
    if (groupId) {
      generateQRString(groupId)
        .then(str => setQrString(str))
        .catch(err => console.error(err));
    }
  }, [groupId]);

  // Clean up scanner on unmount
  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, []);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(qrString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startScanner = async () => {
    setIsScanning(true);
    setScanError('');
    setCameraPermission(true);

    // Give the DOM a tiny bit to render the scanner div
    setTimeout(async () => {
      try {
        const html5QrCode = new Html5Qrcode(scannerId);
        html5QrcodeRef.current = html5QrCode;

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };

        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          async (decodedText) => {
            try {
              // Successfully scanned!
              const importedGroupId = await importFromQRString(decodedText);
              await stopScanner();
              if (onImportSuccess) {
                onImportSuccess(importedGroupId);
              }
            } catch (err) {
              setScanError('Código QR inválido o corrupto.');
            }
          },
          (errorMessage) => {
            // Quiet debug or ignore spammy logs
          }
        );
      } catch (err) {
        console.error('Camera initialization error:', err);
        setCameraPermission(false);
        setIsScanning(false);
      }
    }, 100);
  };

  const stopScanner = async () => {
    if (html5QrcodeRef.current && html5QrcodeRef.current.isScanning) {
      try {
        await html5QrcodeRef.current.stop();
      } catch (e) {
        console.error(e);
      }
    }
    setIsScanning(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-2xl relative overflow-hidden flex flex-col">
        {/* Glow effect */}
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-brand-500/10 rounded-full blur-3xl pointer-events-none"></div>

        {/* Header */}
        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-brand-400" />
            <h3 className="font-bold text-slate-100 text-lg">
              {isScanning ? 'Escanear Código QR' : 'Compartir / Unirse'}
            </h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {!isScanning ? (
          <div className="flex flex-col items-center">
            <p className="text-slate-400 text-xs text-center mb-4">
              Deja que otro miembro escanee este QR para copiar todo el estado del grupo localmente.
            </p>

            {/* QR Wrapper */}
            <div className="bg-white p-4 rounded-xl shadow-inner mb-4 flex items-center justify-center">
              {qrString ? (
                <QRCodeSVG value={qrString} size={200} level="L" includeMargin={false} />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center text-slate-400">
                  <RefreshCw className="w-8 h-8 animate-spin" />
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="w-full flex flex-col gap-2 mt-2">
              <button
                onClick={copyToClipboard}
                disabled={!qrString}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl border border-slate-700 transition-all text-sm"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 text-brand-400" />
                    ¡Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copiar Datos (Texto Raw)
                  </>
                )}
              </button>

              <button
                onClick={startScanner}
                className="w-full flex items-center justify-center gap-2 py-3 bg-brand-600 hover:bg-brand-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-brand-500/10 transition-all text-sm mt-1"
              >
                <Camera className="w-4 h-4" />
                Escanear QR de otro celular
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <p className="text-slate-400 text-xs text-center mb-4">
              Apunta con tu cámara al código QR de Yupana del otro teléfono.
            </p>

            {/* Camera Viewfinder */}
            <div className="relative w-full aspect-square max-w-[280px] bg-slate-950 rounded-xl overflow-hidden border-2 border-dashed border-slate-700 flex items-center justify-center mb-4">
              <div id={scannerId} className="w-full h-full"></div>
              {/* Scan HUD overlays */}
              <div className="absolute inset-0 pointer-events-none border-[12px] border-slate-950/40">
                <div className="absolute inset-10 border border-brand-500/30">
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-brand-500"></div>
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-brand-500"></div>
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-brand-500"></div>
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-brand-500"></div>
                  <div className="w-full h-0.5 bg-brand-500 absolute top-1/2 -translate-y-1/2 opacity-75 shadow-lg shadow-brand-500 animate-pulse"></div>
                </div>
              </div>

              {!cameraPermission && (
                <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center p-4 text-center">
                  <Camera className="w-10 h-10 text-red-400 mb-2" />
                  <p className="text-red-400 font-semibold text-sm">Sin Acceso a Cámara</p>
                  <p className="text-slate-400 text-xs mt-1">Por favor concede permisos de cámara en tu navegador.</p>
                </div>
              )}
            </div>

            {scanError && (
              <p className="text-red-400 text-xs font-semibold mb-3 text-center">{scanError}</p>
            )}

            <button
              onClick={stopScanner}
              className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl border border-slate-700 transition-all text-sm"
            >
              Volver al Código QR
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
