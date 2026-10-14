import React from 'react';

interface MainLayoutProps {
    children: React.ReactNode;
    footer?: React.ReactNode;
}

export const MainLayout: React.FC<MainLayoutProps> = ({ children, footer }) => {
    return (
        <div className="min-h-dvh w-full bg-[#F8F9FC] flex flex-col items-center justify-center pt-14 px-4 pb-4 sm:p-6 lg:p-8 font-sans">
            <main className="w-full max-w-md sm:max-w-lg md:max-w-2xl lg:max-w-3xl flex-grow flex flex-col justify-center">
                <div className="bg-white rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] border border-gray-100 p-6 sm:p-8 md:p-12 w-full transition-all duration-300">
                    {children}
                </div>
            </main>

            {/* Footer / Action Button Area */}
            {footer && (
                <div className="w-full max-w-md sm:max-w-lg md:max-w-2xl lg:max-w-3xl mt-6 sm:mt-8 flex justify-center pb-4 sm:pb-8">
                    {footer}
                </div>
            )}
        </div>
    );
};

