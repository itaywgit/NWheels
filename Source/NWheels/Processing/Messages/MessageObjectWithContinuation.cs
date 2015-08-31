﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace NWheels.Processing.Messages
{
    public abstract class MessageObjectWithContinuation<TMessage> : MessageObjectBase, ISetMessageResult
        where TMessage : MessageObjectWithContinuation<TMessage>
    {
        private Action<TMessage> _onCompletion;
        private Action<TMessage, Exception> _onFailure;

        //-----------------------------------------------------------------------------------------------------------------------------------------------------
        
        protected MessageObjectWithContinuation()
        {
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        protected MessageObjectWithContinuation(IFramework framework)
            : base(framework)
        {
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        #region Implementation of ISetMessageResult

        void ISetMessageResult.SetMessageResult(MessageResult result, Exception error, out Action continuation)
        {
            this.MessageResult = result;

            if ( result == Messages.MessageResult.Processed && _onCompletion != null )
            {
                continuation = () => _onCompletion((TMessage)this);
            }
            else if ( result != Messages.MessageResult.Processed && _onFailure != null )
            {
                continuation = () => _onFailure((TMessage)this, error);
            }
            else
            {
                continuation = null;
            }
        }

        #endregion

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public TMessage OnCompletion(Action<TMessage> callback)
        {
            _onCompletion += callback;
            return (TMessage)this;
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public TMessage OnFailure(Action<TMessage, Exception> callback)
        {
            _onFailure += callback;
            return (TMessage)this;
        }

        //-----------------------------------------------------------------------------------------------------------------------------------------------------

        public MessageResult? MessageResult { get; private set; }
    }
}
