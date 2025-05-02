import * as React from "react";

export declare const Dialog: React.FC<{
  children?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}>;

export declare const DialogTrigger: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & React.RefAttributes<HTMLButtonElement>
>;

export declare const DialogContent: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
>;

export declare const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>>;

export declare const DialogTitle: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLHeadingElement> & React.RefAttributes<HTMLHeadingElement>
>;

export declare const DialogDescription: React.ForwardRefExoticComponent<
  React.HTMLAttributes<HTMLParagraphElement> & React.RefAttributes<HTMLParagraphElement>
>;

export declare const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>>;

export declare const DialogClose: React.ForwardRefExoticComponent<
  React.ButtonHTMLAttributes<HTMLButtonElement> & React.RefAttributes<HTMLButtonElement>
>; 