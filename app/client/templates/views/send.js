/**
Template Controllers

@module Templates
*/

/**
The add user template

@class [template] views_send
@constructor
*/

/**
The query and sort option for all account queries

Set in the created callback.

@property accountQuery
*/
var accountQuery;

/**
The query and sort option for all account queries

Set in the created callback.

@property accountSort
*/
var accountSort;

/**
An empty object for the instantiated contract

@property contractInstance
*/
var contractInstance = [];

/**
Contract Functiond

@property contractFunctions
*/
var contractFunctions = [];
var abihtml = new AbiHtml();


/**
The default gas to provide for estimates. This is set manually,
so that invalid data etsimates this value and we can later set it down and show a warning,
when the user actually wants to send the dummy data.

@property defaultEstimateGas
*/
var defaultEstimateGas = 5000000;

/**
Check if the amount accounts daily limit  and sets the correct text.

@method checkOverDailyLimit
*/
var checkOverDailyLimit = function(address, wei, template){
    // check if under or over dailyLimit
    account = Helpers.getAccountByAddress(address, false);

    // check whats left
    var restDailyLimit = new BigNumber(account.dailyLimit || '0', 10).minus(new BigNumber(account.dailyLimitSpent || '0', 10));

    if(account && account.requiredSignatures > 1 && !_.isUndefined(account.dailyLimit) && account.dailyLimit !== ethereumConfig.dailyLimitDefault && Number(wei) !== 0) {
        if(restDailyLimit.lt(new BigNumber(wei, 10)))
            TemplateVar.set('dailyLimitText', new Spacebars.SafeString(TAPi18n.__('wallet.send.texts.overDailyLimit', {limit: EthTools.formatBalance(restDailyLimit.toString(10)), total: EthTools.formatBalance(account.dailyLimit), count: account.requiredSignatures - 1})));
        else
            TemplateVar.set('dailyLimitText', new Spacebars.SafeString(TAPi18n.__('wallet.send.texts.underDailyLimit', {limit: EthTools.formatBalance(restDailyLimit.toString(10)), total: EthTools.formatBalance(account.dailyLimit)})));
    } else
        TemplateVar.set('dailyLimitText', false);
};

/**
Add a pending transaction to the transaction list, after sending

@method addTransactionAfterSend
*/
var addTransactionAfterSend = function(txHash, amount, from, to, gasPrice, estimatedGas, data, tokenId) {
                                
    txId = Helpers.makeId('tx', txHash);


    Transactions.upsert(txId, {$set: {
        tokenId: tokenId,
        value: amount,
        from: selectedAccount.address,
        to: to,
        timestamp: moment().unix(),
        transactionHash: txHash,
        gasPrice: gasPrice,
        gasUsed: estimatedGas,
        fee: String(gasPrice * estimatedGas),
        data: data
    }});

    // add to Account
    EthAccounts.update(selectedAccount._id, {$addToSet: {
        transactions: txId
    }});

    // add from Account
    EthAccounts.update({address: to}, {$addToSet: {
        transactions: txId
    }});
};

/**
Gas estimation callback

@method estimationCallback
*/
var estimationCallback = function(e, res){
    var template = this;

    console.log('Estimated gas: ', res, e);
    if(!e && res) {
        TemplateVar.set(template, 'estimatedGas', res);

        // show note if its defaultEstimateGas, as the data is not executeable
        if(res === defaultEstimateGas)
            TemplateVar.set(template, 'codeNotExecutable', true);
        else
            TemplateVar.set(template, 'codeNotExecutable', false);
    }
};


// Set basic variables
Template['views_send'].onCreated(function(){
    var template = this;

    // set account queries
    accountQuery = {owners: {$in: _.pluck(EthAccounts.find({}).fetch(), 'address')}, address: {$exists: true}};
    accountSort = {sort: {name: 1}};

    // set the default fee
    TemplateVar.set('selectAction', 'send-funds');
    TemplateVar.set('selectedToken', 'ether');
    TemplateVar.set('amount', '0');
    TemplateVar.set('estimatedGas', 0);
    
    // check if we are still on the correct chain
    Helpers.checkChain(function(error) {
        if(error && (EthAccounts.find().count() > 0)) {
            checkForOriginalWallet();
        }
    });


    // change the amount when the currency unit is changed
    template.autorun(function(c){
        var unit = EthTools.getUnit();

        if(!c.firstRun && TemplateVar.get('selectedToken') === 'ether') {
            TemplateVar.set('amount', EthTools.toWei(template.find('input[name="amount"]').value.replace(',','.'), unit));
        }
    });
});

Template['views_send'].onRendered(function(){
    var template = this;

    // focus address input field
    if(!this.data || !FlowRouter.getParam('address'))
        this.$('input[name="to"]').focus();
    else {
        this.find('input[name="to"]').value = FlowRouter.getParam('address');
        this.$('input[name="to"]').trigger('change');
    }

    // set the from
    var from = FlowRouter.getParam('from');
    if(from)
        TemplateVar.setTo('select[name="dapp-select-account"]', 'value', FlowRouter.getParam('from'));

    

    // ->> GAS PRICE ESTIMATION
    template.autorun(function(c){
        var address = TemplateVar.getFrom('.dapp-select-account', 'value'),
            to = TemplateVar.getFrom('.dapp-address-input', 'value'),
            data = TemplateVar.getFrom('.dapp-data-textarea', 'value'),
            tokenAddress = TemplateVar.get('selectedToken'),
            amount = TemplateVar.get('amount') || '0';

        // make reactive to the show/hide data
        TemplateVar.get('dataShown');


        // if(!web3.isAddress(to))
        //     to = '0x0000000000000000000000000000000000000000';

        // Ether tx estimation
        if(tokenAddress === 'ether') {

            if(EthAccounts.findOne({address: address}, {reactive: false})) {
                web3.eth.estimateGas({
                    from: address,
                    to: to,
                    value: amount,
                    data: data,
                    gas: defaultEstimateGas
                }, estimationCallback.bind(template));

            // Wallet tx estimation
            } else if(wallet = Wallets.findOne({address: address}, {reactive: false})) {

                if(contracts['ct_'+ wallet._id])
                    contracts['ct_'+ wallet._id].execute.estimateGas(to || '', amount || '', data || '',{
                        from: wallet.owners[0],
                        gas: defaultEstimateGas
                    }, estimationCallback.bind(template));
            }

        // Custom coin estimation
        } else {

            TokenContract.at(tokenAddress).transfer.estimateGas(to, amount, {
                from: address,
                gas: defaultEstimateGas
            }, estimationCallback.bind(template));
        }
    });
});


Template['views_send'].helpers({
    /**
    Get all current accounts

    @method (fromAccounts)
    */
    'fromAccounts': function(){
        return _.union(Wallets.find(accountQuery, accountSort).fetch(), EthAccounts.find({}, accountSort).fetch());
    },
    /**
    Get the current selected account

    @method (selectedAccount)
    */
    'selectedAccount': function(){
        return Helpers.getAccountByAddress(TemplateVar.getFrom('.dapp-select-account', 'value'));
    },
    /**
    Get the current selected token document

    @method (selectedToken)
    */
    'selectedToken': function(){
        return Tokens.findOne({address: TemplateVar.get('selectedToken')});
    },
    /**
    Retrun checked, if the current token is selected

    @method (tokenSelectedAttr)
    */
    'tokenSelectedAttr': function(token) {
        return (TemplateVar.get('selectedToken') === token)
            ? {checked: true}
            : {};
    },
    /**
    Get all tokens

    @method (tokens)
    */
    'tokens': function(){
        if(TemplateVar.get('selectAction') === 'send-funds')
            return Tokens.find({},{sort: {name: 1}});
    },
    /**
    Checks if the current selected account has tokens

    @method (hasTokens)
    */
    'hasTokens': function() {
        var selectedAccount = Helpers.getAccountByAddress(TemplateVar.getFrom('.dapp-select-account', 'value')),
            query = {};


        if(!selectedAccount)
            return;

        query['balances.'+ selectedAccount._id] = {$exists: true, $ne: '0'};        
        return Tokens.findOne(query, {field: {_id: 1}});
    },
    /**
    Return the currently selected fee + amount

    @method (total)
    */
    'total': function(ether){
        var amount = TemplateVar.get('amount');
        if(!_.isFinite(amount))
            return '0';

        // ether
        var gasInWei = TemplateVar.getFrom('.dapp-select-gas-price', 'gasInWei') || '0';
        amount = new BigNumber(amount, 10).plus(new BigNumber(gasInWei, 10));
        return amount;
    },
    /**
    Return the currently selected token amount

    @method (tokenTotal)
    */
    'tokenTotal': function(){
        var amount = TemplateVar.get('amount'),
            token = Tokens.findOne({address: TemplateVar.get('selectedToken')});

        if(!_.isFinite(amount) || !token)
            return '0';

        return Helpers.formatNumberByDecimals(amount, token.decimals);
    },
    /**
    Returns the right time text for the "sendText".

    @method (timeText)
    */
    'timeText': function(){
        return TAPi18n.__('wallet.send.texts.timeTexts.'+ ((Number(TemplateVar.getFrom('.dapp-select-gas-price', 'feeMultiplicator')) + 5) / 2).toFixed(0));
    },
    /**
    Get compiled contracts 

    @method (compiledContracts)
    */
    'compiledContracts' : function(){
        return TemplateVar.get("compiledContracts");
    },
    /**
    Get selected contract functions

    @method (selectedContractInputs)
    */
    'selectedContractInputs' : function(){
        return TemplateVar.get("selectedContract").inputs;
    },
    /**

    Shows correct explanation for token type

    @method (sendExplanation)
    */
    'sendExplanation': function(){

        var amount = TemplateVar.get('amount') || '0',
            selectedAccount = Helpers.getAccountByAddress(TemplateVar.getFrom('.dapp-select-account', 'value')),
            token = Tokens.findOne({address: TemplateVar.get('selectedToken')});

        if(!token || !selectedAccount)
            return;

        var tokenBalance = token.balances[selectedAccount._id] || '0',
            formattedAmount = Helpers.formatNumberByDecimals(amount, token.decimals),
            formattedBalance = Helpers.formatNumberByDecimals(tokenBalance, token.decimals);

        return Spacebars.SafeString(TAPi18n.__('wallet.send.texts.sendToken', {amount:formattedAmount, name: token.name, balance: formattedBalance , symbol: token.symbol})); 
        
    },
    /**
    Get Balance of a token

    @method (formattedCoinBalance)
    */
    'formattedCoinBalance': function(e){
        var selectedAccount = Helpers.getAccountByAddress(TemplateVar.getFrom('.dapp-select-account', 'value'));
        return (this.balances && Number(this.balances[selectedAccount._id]) > 0)
            ? Helpers.formatNumberByDecimals(this.balances[selectedAccount._id], this.decimals) +' '+ this.symbol
            : false;
    },
    /**
    Check if to account has code

    @method (accountHasCode)
    */
    'accountHasCode': function(e){
        //0x22a037ffc313beb81cd756151bd504653f7b983d
        //0xa3687db9e245f5ad8a70123f9df0237c11ffc362

        var contract = TemplateVar.getFrom('.dapp-address-input', 'value') || FlowRouter.getParam('address');
        var code = web3.eth.getCode(contract);

        return code != "0x";
    },
    /**
    Get Functions

    @method (tokens)
    */
    'listContractFunctions': function(){
        console.log("remake array");
        return contractFunctions;
    },
    /**
    Returns true if the current selected unit is an ether unit (ether, finney, etc)

    @method (etherUnit)
    */
    'etherUnit': function() {
        var unit = EthTools.getUnit();
        return (unit === 'ether' || unit === 'finney');        
    }
});


Template['views_send'].events({
    /**
    Show the extra data field
    
    @event click button.show-data
    */
    'click button.show-data': function(e){
        e.preventDefault();
        TemplateVar.set('showData', true);
    },
    /**
    Show the extra data field
    
    @event click button.hide-data
    */
    'click button.hide-data': function(e){
        e.preventDefault();
        TemplateVar.set('showData', false);
    },
    /**
    Action Switcher
    
    @event click .select-action input
    */
    'click .select-action input': function(e, template){
        var option = e.currentTarget.value;
        TemplateVar.set('selectAction', option);

        if (option == 'upload-contract') {
            TemplateVar.set('showData', true);
            TemplateVar.set('hideTo', true);
            TemplateVar.set('selectedToken', 'ether');

            TemplateVar.set('savedTo', TemplateVar.getFrom('.dapp-address-input', 'value'));

        } else {
            TemplateVar.set('showData', false);
            TemplateVar.set('hideTo', false);
            Tracker.afterFlush(function() {
                if(TemplateVar.get(template, 'savedTo')) {
                    template.find('input[name="to"]').value = TemplateVar.get(template, 'savedTo');
                    TemplateVar.setTo('.dapp-address-input', 'value', TemplateVar.get(template, 'savedTo'));
                }
            });
        }

        // trigger amount box change
        template.$('input[name="amount"]').trigger('change');
    },
    /**
    Selected a token for the first time
    
    @event 'click .select-token
    */
    'click .select-token input': function(e, template){
        TemplateVar.set('selectedToken', e.currentTarget.value);

        // trigger amount box change
        template.$('input[name="amount"]').trigger('change');
    },
    /**
    Change the ABI
    
    @event keyup input[name="abi"], change input[name="abi"], input input[name="abi"]
    */
    'keyup input[name="abi"], change input[name="abi"], input input[name="abi"]': function(e, template){
        var ABI = JSON.parse(e.currentTarget.value);
        var address = TemplateVar.getFrom('.dapp-address-input', 'value');
        contractInstance = web3.eth.contract(ABI).at(address);

        // Settable properties to override default behavior
        var properties = {
            events: {
                renderCallback: function() {}
            },
            functions: {
                callButtonText: 'Read',
                transactButtonText: 'Update',
                renderCallback: function(htmlDoc) {
                    console.log("asdasda");
                    document.getElementById('execute-functions').appendChild(htmlDoc)
                }
            }
        }


        // Instantiate library with abi and optional properties
        var abihtml = new AbiHtml(e.currentTarget.value, properties);
        document.getElementById('execute-functions').innerHTML = "";
        contractFunctions = [{"name":"Alice"}, {"name": "Eve"}]
        var functionHtmls = "";

        abihtml.functions.forEach(function(func) {

            console.log(func);
            contractFunctions.push({"name":func.abiItem.name});

            functionHtmls +="<option value='function" + func.abiItem.name + "'>" + func.abiItem.name + "</option>";

            func.generateHtml()
        })

        document.getElementById('select-function').innerHTML = functionHtmls;

        console.log(contractFunctions);

        /*
        [{"constant":true,"inputs":[{"name":"","type":"address"}],"name":"balanceOf","outputs":[{"name":"","type":"uint256"}],"type":"function"},{"constant":false,"inputs":[{"name":"receiver","type":"address"},{"name":"amount","type":"uint256"}],"name":"transfer","outputs":[{"name":"sufficient","type":"bool"}],"type":"function"},{"inputs":[{"name":"supply","type":"uint256"}],"type":"constructor"},{"anonymous":false,"inputs":[{"indexed":false,"name":"sender","type":"address"},{"indexed":false,"name":"receiver","type":"address"},{"indexed":false,"name":"amount","type":"uint256"}],"name":"Transfer","type":"event"}]
        */


    },
    /**
    Select function name
    
    @event change select-function
    */
    'keyup change select[name="select-function"]': function(e, template){

        console.log(e.currentTarget.value);    
    },
    /**
    Set the token amount while typing
    Set the amount while typing
    
    @event keyup input[name="amount"], change input[name="amount"], input input[name="amount"]
    */
    'keyup input[name="amount"], change input[name="amount"], input input[name="amount"]': function(e, template){
        // ether
        if(TemplateVar.get('selectedToken') === 'ether') {
            var wei = EthTools.toWei(e.currentTarget.value.replace(',','.'));
            TemplateVar.set('amount', wei || '0');

            checkOverDailyLimit(template.find('select[name="dapp-select-account"]').value, wei, template);
        
        // token
        } else {
            
            var token = Tokens.findOne({address: TemplateVar.get('selectedToken')}),
                amount = e.currentTarget.value || '0';

            amount = new BigNumber(amount, 10).times(Math.pow(10, token.decimals || 0)).floor().toString(10);

            TemplateVar.set('amount', amount);
        }
    },
    /**
    Selected a contract function
    
    @event 'click .contract-functions
    */
    'change .compiled-contracts': function(e, template){
        // get the correct contract
        var selectedContract = _.select(TemplateVar.get("compiledContracts"), function(contract){
            return contract.name == e.currentTarget.value;
        })

        // change the inputs and data field
        TemplateVar.set("selectedContract", selectedContract[0]);
    },
    /**
    Change solidity code
    
    @event keyup textarea.solidity-source, change textarea.solidity-source, input textarea.solidity-source
    */
    'change textarea.solidity-source, input textarea.solidity-source': function(e, template){
        var sourceCode = e.currentTarget.value;
        TemplateVar.set("contractFunctions", false);

        //check if it matches a hex pattern
        if (sourceCode == sourceCode.match("[0-9A-Fa-fx]+")[0]){
            // If matches, just pass if forward to the data field
            // document.getElementsByClassName("dapp-data-textarea")[0].value = sourceCode;
            template.find('.dapp-data-textarea').value = sourceCode;
            TemplateVar.set(template, 'codeNotExecutable', false);

        } else {
            //if it doesnt, try compiling it in solidity
            try {
                var compiled = web3.eth.compile.solidity(sourceCode);
                TemplateVar.set(template, 'codeNotExecutable', false);

                var compiledContracts = [];

                _.each(compiled, function(e, i){
                    var abi = JSON.parse(e.interface);
                    
                    // find the constructor function
                    var constructor = _.select(abi, function(func){
                        return func.type == "constructor";
                    });

                    // substring the type so that string32 and string16 wont need different templates
                    _.each(constructor[0].inputs, function(input){
                        input.template = "input_"+input.type.substr(0,3);
                        var sizes = input.type.match(/[0-9]+/);
                        if (sizes)
                            input.bits = sizes[0];
                    })

                    var simplifiedContractObject = {'name': i, 'bytecode': e.bytecode, 'abi': abi, 'inputs':constructor[0].inputs }
                    
                    TemplateVar.set("selectedContract", simplifiedContractObject); 
                    compiledContracts.push(simplifiedContractObject);   
                })

                TemplateVar.set("compiledContracts", compiledContracts);

            } catch(error) {
                // Doesnt compile in solidity either, throw error
                TemplateVar.set(template, 'codeNotExecutable', true);
                console.log(error.message);
            }
        };
        
        

         
    },
    /**
    Submit the form and send the transaction!
    
    @event submit form
    */
    'submit form': function(e, template){

        var amount = TemplateVar.get('amount') || '0',
            tokenAddress = TemplateVar.get('selectedToken'),
            to = TemplateVar.getFrom('.dapp-address-input', 'value'),
            byteCode = TemplateVar.get('selectedContract').bytecode,
            solidityCode = TemplateVar.getFrom('.solidity-source', 'value'),
            gasPrice = TemplateVar.getFrom('.dapp-select-gas-price', 'gasPrice'),
            estimatedGas = TemplateVar.get('estimatedGas'),
            selectedAccount = Helpers.getAccountByAddress(template.find('select[name="dapp-select-account"]').value),
            selectedAction = TemplateVar.get("selectAction");
        
        console.log("ByteCode: "+ byteCode + " Solidity Code: " + solidityCode);

        if(selectedAccount && !TemplateVar.get('sending')) {

            // set gas down to 21 000, if its invalid data, to prevent high gas usage.
            if(estimatedGas === defaultEstimateGas || estimatedGas === 0)
                estimatedGas = 21000;


            console.log('Providing gas: ', estimatedGas ,' + 100000');


            if(selectedAccount.balance === '0')
                return GlobalNotification.warning({
                    content: 'i18n:wallet.send.error.emptyWallet',
                    duration: 2
                });


            if(!web3.isAddress(to) && selectedAction != "upload-contract")
                return GlobalNotification.warning({
                    content: 'i18n:wallet.send.error.noReceiver',
                    duration: 2
                });


            if(tokenAddress === 'ether') {
                
                if((_.isEmpty(amount) || amount === '0' || !_.isFinite(amount)) && selectedAction != "upload-contract")
                    return GlobalNotification.warning({
                        content: 'i18n:wallet.send.error.noAmount',
                        duration: 2
                    });

                if(new BigNumber(amount, 10).gt(new BigNumber(selectedAccount.balance, 10)))
                    return GlobalNotification.warning({
                        content: 'i18n:wallet.send.error.notEnoughFunds',
                        duration: 2
                    });

            } else {

                var token = Tokens.findOne({address: tokenAddress}),
                    tokenBalance = token.balances[selectedAccount._id] || '0';

                if(new BigNumber(amount, 10).gt(new BigNumber(tokenBalance, 10)))
                    return GlobalNotification.warning({
                        content: 'i18n:wallet.send.error.notEnoughFunds',
                        duration: 2
                    });
            }
            


            // The function to send the transaction
            var sendTransaction = function(estimatedGas){

                // show loading
                // EthElements.Modal.show('views_modals_loading');

                TemplateVar.set(template, 'sending', true);


                // use gas set in the input field
                estimatedGas = estimatedGas || Number($('.send-transaction-info input.gas').val());
                console.log('Finally choosen gas', estimatedGas);

                
                // ETHER TX
                if(tokenAddress === 'ether' && selectedAction != "upload-contract") {
                    console.log('Send Ether');

                    // CONTRACT TX
                    if(contracts['ct_'+ selectedAccount._id]) {

                        contracts['ct_'+ selectedAccount._id].execute.sendTransaction(to || '', amount || '', data || '', {
                            from: selectedAccount.owners[0],
                            gasPrice: gasPrice,
                            gas: estimatedGas
                        }, function(error, txHash){

                            TemplateVar.set(template, 'sending', false);

                            console.log(error, txHash);
                            if(!error) {
                                console.log('SEND from contract', amount);

                                addTransactionAfterSend(txHash, amount, selectedAccount.address, to, gasPrice, estimatedGas, data);

                                FlowRouter.go('dashboard');

                            } else {
                                // EthElements.Modal.hide();

                                GlobalNotification.error({
                                    content: error.message,
                                    duration: 8
                                });
                            }
                        });
                    
                    // SIMPLE TX
                    } else {

                        web3.eth.sendTransaction({
                            from: selectedAccount.address,
                            to: to,
                            data: byteCode,
                            value: amount,
                            gasPrice: gasPrice,
                            gas: estimatedGas
                        }, function(error, txHash){

                            TemplateVar.set(template, 'sending', false);

                            console.log(error, txHash);
                            if(!error) {
                                console.log('SEND simple');

                                addTransactionAfterSend(txHash, amount, selectedAccount.address, to, gasPrice, estimatedGas, data);

                                FlowRouter.go('dashboard');
                            } else {

                                // EthElements.Modal.hide();

                                GlobalNotification.error({
                                    content: error.message,
                                    duration: 8
                                });
                            }
                        });
                         
                    }

                // UPLOAD CONTRACT
                } else if (selectedAction == "upload-contract") {
                    console.log('Solidity Compiler');
                    
                    // CONTRACT TX
                    if(contracts['ct_'+ selectedAccount._id]) {

                        console.log('From contract');

                    
                    // SIMPLE TX
                    } else {
                        console.log('From Account');

                        var selectedContract = TemplateVar.get("selectedContract");

                        // create an array with the input fields
                        var contractArguments = [];

                        _.each(selectedContract.inputs, function(input){
                            var output = $('.abi-input[placeholder="'+input.name+'"]')[0].value;
                            console.log(output);
                            contractArguments.push(output);
                        })

                        // add the default web3 arguments
                        contractArguments.push({
                            from: selectedAccount.address,
                            to: to,
                            value: amount,
                            gasPrice: gasPrice,
                            gas: estimatedGas
                        }, function(error, txHash){});

                        console.log(contractArguments);

                        // publish new contract
                        web3.eth.contract(selectedContract.abi).new(arguments);
                         
                    }


                // TOKEN TRANSACTION
                } else {
                    console.log('Send Token');

                    var tokenInstance = TokenContract.at(tokenAddress);

                    // CONTRACT TX
                    if(contracts['ct_'+ selectedAccount._id]) {
                        var tokenSendData = tokenInstance.transfer.getData(to, amount, {
                            from: selectedAccount.address,
                            gasPrice: gasPrice,
                            gas: estimatedGas
                        });

                        contracts['ct_'+ selectedAccount._id].execute.sendTransaction(tokenAddress, '0', tokenSendData, {
                            from: selectedAccount.owners[0],
                            gasPrice: gasPrice,
                            gas: estimatedGas
                        }, function(error, txHash){

                            TemplateVar.set(template, 'sending', false);

                            console.log(error, txHash);
                            if(!error) {
                                console.log('SEND TOKEN from contract', amount, 'with data ', tokenSendData);

                                addTransactionAfterSend(txHash, amount, selectedAccount.address, to, gasPrice, estimatedGas, data, token._id);

                                FlowRouter.go('dashboard');

                            } else {
                                // EthElements.Modal.hide();

                                GlobalNotification.error({
                                    content: error.message,
                                    duration: 8
                                });
                            }
                        });

                    } else {

                        tokenInstance.transfer.sendTransaction(to, amount, {
                            from: selectedAccount.address,
                            gasPrice: gasPrice,
                            gas: estimatedGas
                        }, function(error, txHash){

                            TemplateVar.set(template, 'sending', false);

                            console.log(error, txHash);
                            if(!error) {
                                console.log('SEND TOKEN', amount);

                                addTransactionAfterSend(txHash, amount, selectedAccount.address, to, gasPrice, estimatedGas, data, token._id);

                                FlowRouter.go('dashboard');
                                // GlobalNotification.warning({
                                //     content: 'token sent',
                                //     duration: 2
                                // });

                            } else {

                                // EthElements.Modal.hide();

                                GlobalNotification.error({
                                    content: error.message,
                                    duration: 8
                                });
                            }
                        });
                    }

                }
            };

            // SHOW CONFIRMATION WINDOW when NOT MIST
            if(typeof mist === 'undefined') {
                EthElements.Modal.question({
                    template: 'views_modals_sendTransactionInfo',
                    data: {
                        from: selectedAccount.address,
                        to: to,
                        amount: amount,
                        gasPrice: gasPrice,
                        estimatedGas: estimatedGas,
                        estimatedGasPlusAddition: estimatedGas + 100000, // increase the provided gas by 100k
                        data: data
                    },
                    ok: sendTransaction,
                    cancel: true
                },{
                    class: 'send-transaction-info'
                });

            // LET MIST HANDLE the CONFIRMATION
            } else {
                sendTransaction(estimatedGas + 100000);
            }
        }
    }
});


