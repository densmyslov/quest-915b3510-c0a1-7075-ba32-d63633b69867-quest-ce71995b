import React from "react";

const FONT_CORMORANT_GARAMOND_IMPORT_SRC =
    "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&display=swap";

/**
 * Set these to your real image paths.
 * - Put both images in /public so they can be referenced by absolute paths.
 * - Portrait is used on phones, Landscape on wider screens.
 */
const HERO_IMAGE_PORTRAIT = "https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20260114-073911-13941768.png/public";
const HERO_IMAGE_LANDSCAPE = "https://imagedelivery.net/PLjImLTp3_--j_ey0SPDBA/clients/915b3510-c0a1-7075-ba32-d63633b69867/app-media/20260114-073936-1f80b26f.png/public";

interface MissionBriefProps {
    onExit: () => void;
    yearText?: string;
}

export default function MissionBrief({
    onExit,
    yearText = "1926",
}: MissionBriefProps) {
    return (
        <div className="missionBriefRoot">
            {/* Background layers */}
            <div className="missionBriefBg missionBriefBg--stars" />
            <div className="missionBriefBg missionBriefBg--vignette" />
            <div className="missionBriefBg missionBriefBg--noise" />
            <div className="missionBriefBg missionBriefBg--twinkle" />

            <div className="missionBriefScroll">
                <div className="missionBriefWrap">
                    {/* Top ornament */}
                    <div className="missionBriefOrnament">
                        <div className="missionBriefOrnamentLine" />
                        <div className="missionBriefOrnamentDot" />
                        <div className="missionBriefOrnamentLine" />
                    </div>

                    {/* Title */}
                    <div className="missionBriefYear">{yearText}</div>

                    {/* Hero frame */}
                    <div className="missionBriefFrameOuter">
                        <div className="missionBriefFrameInner">
                            <div className="missionBriefHero">
                                {/*
                  Responsive image selection (no JS):
                  - Portrait on small screens
                  - Landscape on larger screens
                */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={HERO_IMAGE_LANDSCAPE}
                                    alt="Porta di Prada"
                                    className="missionBriefHeroImg"
                                    srcSet={`${HERO_IMAGE_PORTRAIT} 768w, ${HERO_IMAGE_LANDSCAPE} 1400w`}
                                    sizes="(max-width: 520px) 92vw, (max-width: 860px) 94vw, 1000px"
                                    onError={(e) => {
                                        // Keep the frame even if the image fails.
                                        (e.currentTarget as HTMLImageElement).style.display = "none";
                                    }}
                                />
                                <div className="missionBriefHeroGlow" />
                            </div>
                        </div>
                    </div>

                    {/* Copy */}
                    <div className="missionBriefCopy">
                        Avete due ore per trovare l’uomo <br />
                        scomparso attraverso la{" "}
                        <span className="missionBriefEmphasis">Porta di Prada</span>, <br />
                        la “porta verso l’aldilà”. <br />
                        Agite in fretta, il tempo è essenziale.
                    </div>

                    {/* CTA */}
                    <button className="missionBriefCta" onClick={onExit}>
                        Cerca il punto di concentrazione energetica
                    </button>
                </div>
            </div>

            <style>{`
        @import url('${FONT_CORMORANT_GARAMOND_IMPORT_SRC}');

        .missionBriefRoot{
          position: fixed;
          inset: 0;
          z-index: 100;
          overflow: hidden;
          font-family: "Cormorant Garamond", "Times New Roman", serif;
          background: radial-gradient(1200px 800px at 50% 10%, rgba(54, 36, 86, 0.55), transparent 55%),
                      linear-gradient(180deg, #05050b 0%, #0b0b16 28%, #0b0e22 55%, #070817 100%);
        }

        .missionBriefBg{
          position:absolute;
          inset:0;
          pointer-events:none;
        }

        .missionBriefBg--stars{
          background:
            radial-gradient(2px 2px at 12% 20%, rgba(255,255,255,0.55), transparent 60%),
            radial-gradient(1px 1px at 30% 70%, rgba(255,255,255,0.35), transparent 55%),
            radial-gradient(1.5px 1.5px at 72% 35%, rgba(255,255,255,0.45), transparent 60%),
            radial-gradient(1px 1px at 82% 75%, rgba(255,255,255,0.30), transparent 55%),
            radial-gradient(1px 1px at 55% 15%, rgba(255,255,255,0.25), transparent 55%),
            radial-gradient(1.5px 1.5px at 18% 85%, rgba(255,255,255,0.25), transparent 60%),
            radial-gradient(1px 1px at 92% 25%, rgba(255,255,255,0.28), transparent 55%),
            radial-gradient(900px 600px at 60% 40%, rgba(94, 53, 177, 0.18), transparent 60%),
            radial-gradient(700px 450px at 40% 65%, rgba(130, 64, 255, 0.12), transparent 65%);
          opacity: 0.95;
        }

        .missionBriefBg--vignette{
          background: radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.70) 100%);
        }

        .missionBriefBg--noise{
          background: url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
          opacity: 0.04;
          mix-blend-mode: overlay;
        }

        .missionBriefBg--twinkle{
          background:
            radial-gradient(2px 2px at 22% 30%, rgba(255,215,0,0.20), transparent 60%),
            radial-gradient(2px 2px at 80% 55%, rgba(255,215,0,0.16), transparent 60%),
            radial-gradient(2px 2px at 60% 82%, rgba(255,215,0,0.12), transparent 60%);
          animation: missionTwinkle 6s ease-in-out infinite;
          opacity: 0.8;
        }

        @keyframes missionTwinkle{
          0%,100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.95; transform: scale(1.01); }
        }

        .missionBriefScroll{
          position:absolute;
          inset:0;
          overflow-y:auto;
          -webkit-overflow-scrolling: touch;
          display:flex;
          align-items:center;
          justify-content:center;
          padding: 32px 18px 36px;
        }

        .missionBriefWrap{
          width: min(980px, 100%);
          text-align:center;
          display:flex;
          flex-direction:column;
          align-items:center;
          gap: 18px;
          padding-bottom: 18px;
        }

        .missionBriefOrnament{
          display:flex;
          align-items:center;
          justify-content:center;
          gap: 10px;
          margin-top: 6px;
          margin-bottom: 2px;
          opacity: 0.95;
        }

        .missionBriefOrnamentLine{
          width: 110px;
          height: 2px;
          background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.55), transparent);
          filter: drop-shadow(0 0 10px rgba(255,215,0,0.22));
        }

        .missionBriefOrnamentDot{
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: rgba(255, 215, 0, 0.85);
          box-shadow: 0 0 16px rgba(255, 215, 0, 0.35);
        }

        .missionBriefYear{
          font-weight: 300;
          letter-spacing: 0.34em;
          color: #ffd36a;
          text-shadow:
            0 0 24px rgba(255, 215, 0, 0.28),
            0 0 64px rgba(138, 43, 226, 0.22);
          font-size: clamp(44px, 7vw, 78px);
          line-height: 1;
          margin-top: 2px;
        }

        .missionBriefFrameOuter{
          width: 100%;
          border-radius: 26px;
          padding: 10px;
          background: linear-gradient(180deg, rgba(255,215,0,0.22), rgba(255,215,0,0.06));
          box-shadow:
            0 0 40px rgba(138,43,226,0.18),
            inset 0 0 0 1px rgba(255,215,0,0.18);
        }

        .missionBriefFrameInner{
          border-radius: 20px;
          padding: 10px;
          background: rgba(6, 6, 14, 0.35);
          border: 1px solid rgba(255,215,0,0.12);
          box-shadow: inset 0 0 28px rgba(0,0,0,0.45);
          backdrop-filter: blur(10px);
        }

        .missionBriefHero{
          position: relative;
          width: 100%;
          border-radius: 14px;
          overflow: hidden;
          background:
            radial-gradient(700px 420px at 50% 65%, rgba(120, 80, 255, 0.25), transparent 60%),
            linear-gradient(180deg, rgba(18,18,36,0.75), rgba(8,8,18,0.75));
          aspect-ratio: 16 / 9;
        }

        /* Portrait phones: closer to the vertical screenshot */
        @media (max-width: 520px){
          .missionBriefHero{ aspect-ratio: 4 / 3; }
          .missionBriefOrnamentLine{ width: 88px; }
          /* Optional: tweak crop focus for portrait asset */
          .missionBriefHeroImg{ object-position: center 65%; }
        }

        /* Wide screens: cinematic like the horizontal screenshot */
        @media (min-width: 860px){
          .missionBriefHero{ aspect-ratio: 21 / 9; }
        }

        .missionBriefHeroImg{
          position:absolute;
          inset:0;
          width:100%;
          height:100%;
          object-fit: cover;
          object-position: center;
          transform: scale(1.02);
          filter: saturate(1.05) contrast(1.05);
        }

        .missionBriefHeroGlow{
          position:absolute;
          inset:-20%;
          background: radial-gradient(circle at 50% 75%, rgba(140, 90, 255, 0.18), transparent 55%);
          animation: missionGlow 4s ease-in-out infinite;
          pointer-events:none;
        }

        @keyframes missionGlow{
          0%,100%{ opacity: 0.55; transform: scale(1); }
          50%{ opacity: 0.85; transform: scale(1.03); }
        }

        .missionBriefCopy{
          max-width: 780px;
          color: rgba(232,232,240,0.92);
          font-size: clamp(18px, 2.5vw, 24px);
          line-height: 1.55;
          text-shadow: 0 2px 10px rgba(0,0,0,0.60);
          margin-top: 6px;
          padding: 0 8px;
        }

        .missionBriefEmphasis{
          color: rgba(220, 190, 255, 0.95);
          font-style: italic;
          text-shadow: 0 0 18px rgba(160, 120, 255, 0.25);
        }

        .missionBriefCta{
          appearance:none;
          border: 1px solid rgba(180, 120, 255, 0.42);
          color: rgba(255,255,255,0.95);
          font-size: clamp(16px, 2.1vw, 20px);
          padding: 14px 26px;
          border-radius: 999px;
          background:
            radial-gradient(120% 160% at 30% 20%, rgba(150, 90, 255, 0.35), transparent 55%),
            linear-gradient(180deg, rgba(86, 40, 160, 0.65), rgba(44, 18, 88, 0.55));
          box-shadow:
            0 0 18px rgba(138, 43, 226, 0.45),
            0 0 46px rgba(90, 40, 180, 0.25);
          cursor: pointer;
          transition: transform 180ms ease, box-shadow 180ms ease;
          margin-top: 6px;
        }

        .missionBriefCta:hover{
          transform: translateY(-1px);
          box-shadow:
            0 0 22px rgba(138, 43, 226, 0.60),
            0 0 60px rgba(90, 40, 180, 0.30);
        }

        .missionBriefCta:active{
          transform: translateY(0px);
        }

        .missionBriefCta:focus-visible{
          outline: 2px solid rgba(255,215,0,0.45);
          outline-offset: 3px;
        }
      `}</style>
        </div>
    );
}
