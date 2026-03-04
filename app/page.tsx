import VoiceDemo from "./VoiceDemo";
import Image from "next/image";

export default function Page() {
  return (
    <main className="container">
      <header className="header">
        <div className="brand">
          <div className="logoImgWrap">
            <Image
              src="/logo.png"
              alt="Tu empresa"
              width={44}
              height={44}
              style={{ objectFit: "cover" }}
            />
          </div>

          <div className="hgroup">
            <h1>AIForma Demo</h1>
            <p>Asistencia inteligente y acompañamiento del razonamiento.</p>
          </div>
        </div>

        <div className="badges">
          <span className="badge">Conectividad & Conocimiento</span>
        </div>
      </header>

      <VoiceDemo />
    </main>
  );
}